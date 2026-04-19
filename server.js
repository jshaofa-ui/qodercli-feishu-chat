/**
 * Qoder CLI 飞书机器人 - WebSocket 长连接模式
 * 核心功能：
 * 1. 监听飞书消息 (im.message.receive_v1) -> 调用 qodercli -> 回复
 * 2. 监听卡片按钮点击 (card.action.trigger) -> 处理审批回调
 */

const { exec } = require('child_process');
const { buildTestCard, buildPermissionCard, buildResolvedCard, buildCommandCard } = require('./card');
const {
  createApproval,
  resolveApproval,
  waitForApproval,
  getPendingCount,
  getPendingApprovals,
  clearAllApprovals,
  queryApprovalTasks,
  approveTask,
  rejectTask,
  getApprovalInstance
} = require('./approval');
const {
  startTerminal,
  stopTerminal,
  sendToTerminal,
  watchOutput,
  handleFeishuMessage: handleTerminalMessage,
  isRunning: isTerminalRunning
} = require('./terminal-bridge');

const PROFILE = 'cli_a91d6fb107f8dbd8'; // 幻视应用 profile
const PRIVATE_CHAT_ID = 'oc_c30f6d7aa03f97cca0b4e588f5dcafc5'; // 私聊窗口 ID
const processedMessages = new Set();

// 私聊会话状态
const privateChatState = {
  lastMessageTime: null,
  messageCount: 0,
  isProcessing: false
};

// 定期清理过期消息
setInterval(() => {
  if (processedMessages.size > 1000) {
    processedMessages.clear();
  }
}, 60000);

// ============================================================
// 飞书消息发送
// ============================================================

/**
 * 发送飞书文本消息
 */
function sendFeishuText(chatId, text) {
  return new Promise((resolve, reject) => {
    const escapedText = text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$')
      .substring(0, 500);

    const cmd = `lark-cli im +messages-send --chat-id "${chatId}" --text "${escapedText}" --as bot --profile ${PROFILE}`;

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
 * 发送飞书卡片消息
 */
function sendFeishuCard(chatId, cardJson) {
  return new Promise((resolve, reject) => {
    const cardStr = JSON.stringify(cardJson).replace(/"/g, '\\"');
    const cmd = `lark-cli im +messages-send --chat-id "${chatId}" --content "${cardStr}" --msg-type interactive --as bot --profile ${PROFILE}`;

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error(`[CARD] 错误: ${err.message}`);
        reject(err);
      } else {
        console.log(`[CARD] 发送成功`);
        resolve(stdout);
      }
    });
  });
}

// ============================================================
// Qoder CLI 调用
// ============================================================

/**
 * 调用 qodercli 获取 AI 回复
 * @param {string} text - 用户消息
 * @param {boolean} isPrivate - 是否是私聊消息（使用 -c 继续对话）
 */
function callQoder(text, isPrivate = false) {
  return new Promise((resolve) => {
    const prompt = text.substring(0, 1000);
    const escapedPrompt = prompt
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    // 私聊使用 -c 继续对话，保持上下文；群聊使用独立提问
    const cmd = isPrivate
      ? `timeout 120 qodercli --model qmodel -c -p "${escapedPrompt}" 2>&1`
      : `timeout 120 qodercli --model qmodel -p "${escapedPrompt}" 2>&1`;

    const modeLabel = isPrivate ? 'private-continue' : 'group-ask';
    console.log(`[QODER] Calling qodercli mode=${modeLabel}`);

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
        .substring(0, 2000); // 私聊回复可以长一些

      console.log(`[QODER] 回复: ${reply.substring(0, 50)}...`);
      resolve(reply || '未获取到回复');
    });
  });
}

// ============================================================
// 审批功能
// ============================================================

/**
 * 处理审批按钮点击
 */
async function handleApprovalAction(actionValue, openChatId) {
  const action = actionValue.action;
  const approvalId = actionValue.approval_id;
  const chatId = actionValue.chat_id || openChatId;

  console.log(`[APPROVAL] 按钮点击: action=${action}, id=${approvalId}, chat=${chatId}`);

  if (!chatId) {
    console.error('[APPROVAL] 无法获取 chat_id');
    return;
  }

  let response = '';
  switch (action) {
    case 'approve':
      response = `✅ 审批已同意 (ID: ${approvalId})`;
      break;
    case 'reject':
      response = `❌ 审批已拒绝 (ID: ${approvalId})`;
      break;
    case 'view_details':
      response = `📋 审批详情 (ID: ${approvalId})`;
      break;
    default:
      if (actionValue.test) {
        response = `✅ 测试回调成功！时间: ${new Date().toISOString()}`;
      } else {
        response = `❓ 未知的操作: ${action}`;
      }
  }

  // 解析等待中的审批 Promise
  if (approvalId && approvals.has(approvalId)) {
    const resolver = approvals.get(approvalId);
    resolver(action);
    approvals.delete(approvalId);
  }

  await sendFeishuText(chatId, response);
}

/**
 * 处理审批相关命令
 */
async function handleApprovalCommand(chatId, text) {
  const trimmed = text.trim();

  // 测试卡片
  if (trimmed === '审批测试' || trimmed === '测试审批') {
    const testCard = buildTestCard();
    await sendFeishuCard(chatId, testCard);
    await sendFeishuText(chatId, '已发送测试卡片，请点击按钮测试');
    return true;
  }

  // 权限审批示例（本地卡片回调）
  if (trimmed.startsWith('权限审批') || trimmed.startsWith('申请权限')) {
    const approvalId = `perm_${Date.now()}`;

    // 创建审批 Promise
    const { approvalId: id, promise } = createApproval({
      id: approvalId,
      type: 'permission',
      title: '权限审批',
      applicant: '测试用户',
      permission: '服务器访问权限',
      reason: '测试审批功能',
      chatId
    });

    const card = buildPermissionCard({
      applicant: '测试用户',
      permission: '服务器访问权限',
      reason: '测试审批功能',
      approvalId: id
    });

    await sendFeishuCard(chatId, card);

    // 等待用户点击按钮
    try {
      const result = await promise;
      if (result.choice === 'approve') {
        await sendFeishuText(chatId, `✅ 审批 #${id} 已通过，权限已授予`);
      } else {
        await sendFeishuText(chatId, `❌ 审批 #${id} 已拒绝`);
      }
    } catch (err) {
      await sendFeishuText(chatId, `⏰ 审批 #${id} 超时`);
    }

    return true;
  }

  // 查询我的待办审批（飞书正式审批流程）
  if (trimmed === '我的审批' || trimmed === '审批任务' || trimmed === '查询审批') {
    const tasks = await queryApprovalTasks({ status: 'pending', pageSize: 10 });

    if (tasks.length === 0) {
      await sendFeishuText(chatId, '当前没有待处理的审批任务');
    } else {
      let msg = `📋 待办审批 (${tasks.length} 个):\n\n`;
      for (const task of tasks.slice(0, 5)) {
        msg += `**任务ID:** ${task.task_id || task.id}\n`;
        msg += `**状态:** ${task.status || '待处理'}\n`;
        msg += `**创建时间:** ${task.create_time || '-'}\n\n`;
      }
      if (tasks.length > 5) {
        msg += `...还有 ${tasks.length - 5} 个任务`;
      }
      msg += `\n\n**操作命令：**\n- 同意审批 <任务ID>\n- 拒绝审批 <任务ID> <理由>`;
      await sendFeishuText(chatId, msg);
    }
    return true;
  }

  // 同意审批任务
  if (trimmed.startsWith('同意审批') || trimmed.startsWith('批准审批')) {
    const parts = trimmed.split(/\s+/);
    const taskId = parts[1];

    if (!taskId) {
      await sendFeishuText(chatId, '请提供任务ID，例如：同意审批 12345');
      return true;
    }

    const success = await approveTask(taskId, '已通过');
    if (success) {
      await sendFeishuText(chatId, `✅ 审批任务 ${taskId} 已同意`);
    } else {
      await sendFeishuText(chatId, `❌ 审批任务 ${taskId} 同意失败`);
    }
    return true;
  }

  // 拒绝审批任务
  if (trimmed.startsWith('拒绝审批')) {
    const parts = trimmed.split(/\s+/);
    const taskId = parts[1];
    const reason = parts.slice(2).join(' ') || '不符合要求';

    if (!taskId) {
      await sendFeishuText(chatId, '请提供任务ID，例如：拒绝审批 12345 不符合要求');
      return true;
    }

    const success = await rejectTask(taskId, reason);
    if (success) {
      await sendFeishuText(chatId, `❌ 审批任务 ${taskId} 已拒绝，理由：${reason}`);
    } else {
      await sendFeishuText(chatId, `❌ 审批任务 ${taskId} 拒绝失败`);
    }
    return true;
  }

  // 查看待处理审批（本地卡片回调）
  if (trimmed === '待处理审批' || trimmed === '审批列表') {
    const count = getPendingCount();
    if (count === 0) {
      await sendFeishuText(chatId, '当前没有待处理的本地审批');
    } else {
      const pending = getPendingApprovals();
      let msg = `待处理本地审批 (${count} 个):\n\n`;
      for (const p of pending) {
        msg += `#${p.id} - ${p.data.title || '未命名'} (${p.age}前)\n`;
      }
      await sendFeishuText(chatId, msg);
    }
    return true;
  }

  return false;
}

/**
 * 处理私聊专用命令
 */
function handlePrivateCommand(chatId, text) {
  const trimmed = text.trim();

  // 查看私聊会话状态
  if (trimmed === '会话状态' || trimmed === '状态') {
    const status = `📊 私聊会话状态\n\n` +
      `最后消息时间: ${privateChatState.lastMessageTime ? new Date(privateChatState.lastMessageTime).toLocaleString() : '无'}\n` +
      `消息数量: ${privateChatState.messageCount} 条\n` +
      `处理状态: ${privateChatState.isProcessing ? '处理中...' : '空闲'}`;
    sendFeishuText(chatId, status);
    return true;
  }

  return false;
}

// ============================================================
// 事件处理
// ============================================================

/**
 * 处理飞书事件（消息 + 卡片回调）
 */
async function handleFeishuEvent(eventData) {
  try {
    const event = JSON.parse(eventData);
    const eventType = event.header?.event_type;

    // 处理消息事件
    if (eventType === 'im.message.receive_v1') {
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
      const isPrivate = chatId === PRIVATE_CHAT_ID;

      console.log(`[MSG] ${isPrivate ? '私聊' : '群聊'} ${chatId}: ${text.substring(0, 80)}`);

      // 私聊消息：使用终端桥接
      if (isPrivate) {
        // 先检查是否是终端控制命令
        const terminalHandled = await handleTerminalMessage(chatId, text);
        if (terminalHandled) return;

        // 普通对话：如果终端在运行，发送到终端
        if (isTerminalRunning()) {
          sendToTerminal(text);
          return;
        }

        // 终端未运行：使用传统的 qodercli 调用
        const handled = await handlePrivateCommand(chatId, text);
        if (handled) return;

        privateChatState.lastMessageTime = Date.now();
        privateChatState.messageCount++;

        if (privateChatState.isProcessing) {
          await sendFeishuText(chatId, '正在处理上一条消息，请稍候...');
          return;
        }

        privateChatState.isProcessing = true;
        try {
          const reply = await callQoder(text, true);
          await sendFeishuText(chatId, reply);
        } finally {
          privateChatState.isProcessing = false;
        }
        return;
      }

      // 群聊消息：处理审批命令或普通对话
      const handled = await handleApprovalCommand(chatId, text);
      if (handled) return;

      // 普通对话：调用 qodercli 并回复
      const reply = await callQoder(text, false);
      await sendFeishuText(chatId, reply);
    }

    // 处理卡片按钮点击事件
    else if (eventType === 'card.action.trigger') {
      console.log(`[CARD ACTION] 卡片按钮点击`);

      const actionValue = event.event?.action?.value;
      const openChatId = event.event?.context?.open_chat_id;

      if (actionValue) {
        await handleApprovalAction(actionValue, openChatId);
      } else {
        console.log(`[CARD ERROR] 未找到 action value: ${JSON.stringify(event)}`);
      }
    }

  } catch (e) {
    console.error(`[ERROR] 事件处理失败: ${e.message}`);
  }
}

// ============================================================
// 启动 WebSocket 事件监听
// ============================================================

/**
 * 启动长连接监听（同时监听消息和卡片回调）
 */
function startEventListener() {
  console.log('='.repeat(50));
  console.log('Qoder CLI 飞书机器人 - WebSocket 长连接模式');
  console.log('='.repeat(50));
  console.log('[FEATURES] 消息处理 + 交互式卡片 + 审批功能');
  console.log('[READY] 开始监听飞书事件...\n');

  // 同时监听消息和卡片回调事件
  const eventProc = exec(
    `lark-cli event +subscribe --as bot --force --event-types im.message.receive_v1,card.action.trigger --profile ${PROFILE}`
  );

  eventProc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        handleFeishuEvent(line);
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

// 启动终端桥接（可选，用户通过飞书命令启动）
// 默认不自动启动，等待用户发送"启动终端"命令
console.log('\n💡 私聊发送 "启动终端" 可开启终端双向同步');

process.on('SIGINT', () => {
  console.log('\n[EXIT] 正在退出...');
  stopTerminal();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[EXIT] 正在退出...');
  stopTerminal();
  process.exit(0);
});
