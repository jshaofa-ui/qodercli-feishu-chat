/**
 * 终端桥接服务 - 使用 script 创建伪终端
 * 
 * 方案：
 * 1. 使用 script -c "qodercli" 创建伪终端会话
 * 2. 通过 FIFO 管道向终端发送输入
 * 3. 监听 script 输出并转发到飞书
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROFILE = 'cli_a91d6fb107f8dbd8';
const PRIVATE_CHAT_ID = 'oc_c30f6d7aa03f97cca0b4e588f5dcafc5';
const LOG_FILE = path.join(__dirname, 'terminal-output.log');
const INPUT_FIFO = path.join(__dirname, 'terminal-input.fifo');

// 终端会话状态
const terminalState = {
  isRunning: false,
  scriptProcess: null,
  qoderProcess: null,
  lastReadPos: 0,
  outputBuffer: '',
  lastForwardTime: 0
};

// ============================================================
// 飞书消息发送
// ============================================================

function sendFeishuText(chatId, text) {
  return new Promise((resolve, reject) => {
    if (!text || !text.trim()) { resolve(); return; }

    const maxLen = 1800;
    const truncated = text.length > maxLen ? text.substring(0, maxLen) + '\n...(已截断)' : text;
    const escaped = truncated.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');

    exec(`lark-cli im +messages-send --chat-id "${chatId}" --text "${escaped}" --as bot --profile ${PROFILE}`, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ============================================================
// 终端会话管理
// ============================================================

/**
 * 启动终端会话
 */
function startTerminal() {
  return new Promise((resolve, reject) => {
    if (terminalState.isRunning) {
      resolve('already running');
      return;
    }

    console.log('[BRIDGE] Starting terminal session...');

    // 清理旧文件
    if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
    if (fs.existsSync(INPUT_FIFO)) fs.unlinkSync(INPUT_FIFO);

    // 使用 script 命令启动 qodercli
    const scriptCmd = `script -q -f "${LOG_FILE}" -c "qodercli --model qmodel"`;

    const scriptProc = spawn('bash', ['-c', scriptCmd], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false
    });

    terminalState.scriptProcess = scriptProc;
    terminalState.isRunning = true;
    terminalState.lastReadPos = 0;
    terminalState.outputBuffer = '';

    // 监听 script 的 stdin（用于发送输入）
    scriptProc.stdin.on('error', (e) => console.error('[BRIDGE] stdin error:', e.message));

    // 监听 script 退出
    scriptProc.on('close', (code) => {
      console.log(`[BRIDGE] Script exited with code: ${code}`);
      terminalState.isRunning = false;
      terminalState.scriptProcess = null;

      // 3秒后自动重启
      setTimeout(() => {
        if (!terminalState.isRunning) {
          console.log('[BRIDGE] Auto-restarting...');
          startTerminal();
        }
      }, 3000);
    });

    scriptProc.on('error', (err) => {
      console.error(`[BRIDGE] Script error: ${err.message}`);
    });

    console.log(`[BRIDGE] Terminal started, PID: ${scriptProc.pid}`);

    // 等待输出文件创建
    setTimeout(() => {
      if (fs.existsSync(LOG_FILE)) {
        console.log('[BRIDGE] Log file ready');
        resolve(scriptProc.pid);
      } else {
        console.warn('[BRIDGE] Log file not created yet');
        resolve(scriptProc.pid);
      }
    }, 2000);
  });
}

/**
 * 停止终端
 */
function stopTerminal() {
  if (terminalState.scriptProcess) {
    terminalState.scriptProcess.kill('SIGTERM');
    terminalState.isRunning = false;
    terminalState.scriptProcess = null;
    console.log('[BRIDGE] Terminal stopped');
  }
}

/**
 * 向终端发送输入
 */
function sendToTerminal(text) {
  if (!terminalState.isRunning || !terminalState.scriptProcess) {
    console.error('[BRIDGE] Terminal not running');
    return false;
  }

  try {
    // 写入 stdin（script 会转发到 qodercli）
    terminalState.scriptProcess.stdin.write(text + '\n');
    console.log(`[BRIDGE] Input sent: ${text.substring(0, 50)}...`);
    return true;
  } catch (e) {
    console.error(`[BRIDGE] Send error: ${e.message}`);
    return false;
  }
}

// ============================================================
// 输出监听和转发
// ============================================================

/**
 * 监听终端输出
 */
function watchOutput() {
  if (!terminalState.isRunning) {
    setTimeout(watchOutput, 3000);
    return;
  }

  if (!fs.existsSync(LOG_FILE)) {
    setTimeout(watchOutput, 2000);
    return;
  }

  try {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size <= terminalState.lastReadPos) {
      setTimeout(watchOutput, 1000);
      return;
    }

    // 读取新增内容
    const fd = fs.openSync(LOG_FILE, 'r');
    const buffer = Buffer.alloc(stats.size - terminalState.lastReadPos);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, terminalState.lastReadPos);
    fs.closeSync(fd);

    terminalState.lastReadPos = stats.size;

    if (bytesRead === 0) {
      setTimeout(watchOutput, 1000);
      return;
    }

    let newText = buffer.toString('utf8');

    // 清理 ANSI 转义序列
    newText = newText
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\^.^/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    // 累积输出
    terminalState.outputBuffer += newText;

    // 定时 flush
    scheduleForward();

  } catch (e) {
    console.error(`[BRIDGE] Watch error: ${e.message}`);
  }

  setTimeout(watchOutput, 1000);
}

let forwardTimer = null;

/**
 * 定时合并输出
 */
function scheduleForward() {
  if (forwardTimer) clearTimeout(forwardTimer);
  forwardTimer = setTimeout(flushForward, 800);
}

/**
 * 转发输出到飞书
 */
async function flushForward() {
  if (!terminalState.outputBuffer.trim()) return;

  const now = Date.now();
  if (now - terminalState.lastForwardTime < 1500) {
    return; // 频率限制
  }

  const output = terminalState.outputBuffer.trim();
  terminalState.outputBuffer = '';
  terminalState.lastForwardTime = now;

  // 清理并截断
  const cleaned = output
    .split('\n')
    .filter(line => line.trim().length > 0 && !line.includes('[H') && !line.includes('[2J'))
    .join('\n')
    .substring(0, 1800);

  if (cleaned.length > 10) {
    try {
      await sendFeishuText(PRIVATE_CHAT_ID, `📟 终端:\n${cleaned}`);
      console.log(`[BRIDGE] Forwarded ${cleaned.length} chars`);
    } catch (e) {
      console.error(`[BRIDGE] Forward error: ${e.message}`);
    }
  }
}

// ============================================================
// 飞书消息处理
// ============================================================

async function handleFeishuMessage(chatId, text) {
  if (chatId !== PRIVATE_CHAT_ID) return false;

  const trimmed = text.trim();

  // 控制命令
  if (trimmed === '终端状态') {
    await sendFeishuText(chatId, terminalState.isRunning ? '✅ 终端运行中' : '❌ 终端未运行');
    return true;
  }

  if (trimmed === '启动终端') {
    if (terminalState.isRunning) {
      await sendFeishuText(chatId, '终端已在运行');
    } else {
      await startTerminal();
      await sendFeishuText(chatId, '✅ 终端已启动');
    }
    return true;
  }

  if (trimmed === '停止终端') {
    stopTerminal();
    await sendFeishuText(chatId, '❌ 终端已停止');
    return true;
  }

  // 普通消息
  if (terminalState.isRunning) {
    console.log(`[BRIDGE] Feishu→Terminal: ${trimmed.substring(0, 80)}`);
    sendToTerminal(trimmed);
    return true;
  }

  await sendFeishuText(chatId, '发送 "启动终端" 开始');
  return true;
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  startTerminal,
  stopTerminal,
  sendToTerminal,
  watchOutput,
  handleFeishuMessage,
  isRunning: () => terminalState.isRunning
};
