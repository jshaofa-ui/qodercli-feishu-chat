/**
 * Qoder CLI 飞书机器人 - 长连接模式
 * 核心功能：监听飞书消息 -> 调用 qodercli -> 回复消息
 */

const { exec } = require('child_process');

const processedMessages = new Set();
const MESSAGE_EXPIRE_TIME = 5 * 60 * 1000;

// 定期清理过期消息
setInterval(() => {
  if (processedMessages.size > 1000) {
    processedMessages.clear();
  }
}, 60000);

/**
 * 发送飞书消息
 */
function sendFeishuMessage(chatId, text) {
  return new Promise((resolve, reject) => {
    const escapedText = text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$')
      .substring(0, 500);

    const cmd = `lark-cli im +messages-send --chat-id "${chatId}" --text "${escapedText}" --as bot`;

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error(`[SEND] 错误: ${err.message}`);
        reject(err);
      } else {
        console.log(`[SEND] 成功`);
        resolve(stdout);
      }
    });
  });
}

/**
 * 调用 qodercli 获取 AI 回复
 */
function callQoder(text) {
  return new Promise((resolve) => {
    const prompt = text.substring(0, 1000);
    const escapedPrompt = prompt
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    const cmd = `timeout 120 qodercli --model qmodel -p "${escapedPrompt}" 2>&1`;

    console.log(`[QODER] 调用 qodercli...`);

    exec(cmd, { timeout: 125000 }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed) {
          console.log('[QODER] 请求超时');
          resolve('请求超时，请稍后重试');
        } else {
          console.error(`[QODER] 错误: ${err.message}`);
          resolve('处理请求时发生错误');
        }
        return;
      }

      let reply = stdout.trim()
        .replace(/\x1b\[[0-9;]*m/g, '')
        .substring(0, 500);

      console.log(`[QODER] 回复: ${reply.substring(0, 50)}...`);
      resolve(reply || '未获取到回复');
    });
  });
}

/**
 * 处理飞书消息事件
 */
async function handleMessage(eventData) {
  try {
    const event = JSON.parse(eventData);

    if (event.header?.event_type !== 'im.message.receive_v1') return;

    const message = event.event?.message;
    if (!message?.message_id) return;

    // 去重
    if (processedMessages.has(message.message_id)) return;
    processedMessages.add(message.message_id);

    // 跳过机器人消息
    if (message.sender?.sender_type === 'app') return;

    // 解析消息内容
    let text = '';
    try {
      const content = typeof message.content === 'string'
        ? JSON.parse(message.content)
        : message.content;
      text = content?.text || '';
    } catch {
      text = message.content || '';
    }

    if (!text?.trim()) return;

    const chatId = message.chat_id;
    console.log(`[MSG] ${chatId}: ${text.substring(0, 80)}`);

    // 调用 qodercli 并回复
    const reply = await callQoder(text);
    await sendFeishuMessage(chatId, reply);

  } catch (e) {
    console.error(`[ERROR] 事件处理失败: ${e.message}`);
  }
}

/**
 * 启动长连接监听
 */
function startEventListener() {
  console.log('='.repeat(50));
  console.log('Qoder CLI 飞书机器人 - 长连接模式');
  console.log('='.repeat(50));
  console.log('[READY] 开始监听飞书事件...\n');

  const eventProc = exec('lark-cli event +subscribe --as bot --force');

  eventProc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        handleMessage(line);
      } catch (e) {
        // 忽略非 JSON 行
      }
    }
  });

  eventProc.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[EVENT] ${msg}`);
  });

  eventProc.on('close', (code) => {
    console.log(`[EVENT] 连接关闭，退出码: ${code}`);
    console.log('[EVENT] 5 秒后重连...');
    setTimeout(startEventListener, 5000);
  });

  eventProc.on('error', (err) => {
    console.error(`[EVENT] 启动失败: ${err.message}`);
    console.log('[EVENT] 5 秒后重试...');
    setTimeout(startEventListener, 5000);
  });
}

startEventListener();

process.on('SIGINT', () => {
  console.log('\n[EXIT] 正在退出...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[EXIT] 正在退出...');
  process.exit(0);
});
