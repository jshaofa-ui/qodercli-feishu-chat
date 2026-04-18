/**
 * 审批管理模块
 * 功能：
 * 1. 本地审批状态管理（卡片按钮回调）
 * 2. 飞书正式审批流程 API 集成（lark-cli approval）
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// ============================================================
// 本地审批状态管理（卡片按钮回调）
// ============================================================

const approvals = new Map();
let approvalCounter = 0;
const APPROVAL_TIMEOUT = 5 * 60 * 1000; // 5分钟超时

/**
 * 创建本地审批请求（用于卡片按钮回调）
 * @param {object} data - 审批数据
 * @returns {{ approvalId: string, promise: Promise }}
 */
function createApproval(data) {
  const approvalId = data.id || `local_${++approvalCounter}`;

  let resolveFunc, rejectFunc;
  const promise = new Promise((resolve, reject) => {
    resolveFunc = resolve;
    rejectFunc = reject;
  });

  approvals.set(approvalId, {
    resolve: resolveFunc,
    reject: rejectFunc,
    data,
    createdAt: Date.now(),
    timeout: setTimeout(() => {
      rejectFunc(new Error('审批超时'));
      approvals.delete(approvalId);
    }, APPROVAL_TIMEOUT)
  });

  console.log(`[APPROVAL] 创建审批 #${approvalId}: ${data.title || '未命名'}`);
  return { approvalId, promise };
}

/**
 * 解析本地审批（用户点击卡片按钮后调用）
 */
function resolveApproval(approvalId, choice, operatorId) {
  const state = approvals.get(approvalId);
  if (!state) {
    console.log(`[APPROVAL] 未找到审批 #${approvalId}`);
    return false;
  }

  clearTimeout(state.timeout);
  state.resolve({ choice, operatorId, data: state.data });
  approvals.delete(approvalId);

  console.log(`[APPROVAL] 解析审批 #${approvalId}: ${choice} by ${operatorId}`);
  return true;
}

/**
 * 等待本地审批结果
 */
function waitForApproval(approvalId) {
  const state = approvals.get(approvalId);
  if (!state) {
    return Promise.reject(new Error('审批不存在'));
  }
  return state.promise;
}

/**
 * 获取待处理审批数量
 */
function getPendingCount() {
  return approvals.size;
}

/**
 * 获取所有待处理审批列表
 */
function getPendingApprovals() {
  const result = [];
  for (const [id, state] of approvals.entries()) {
    result.push({
      id,
      data: state.data,
      createdAt: state.createdAt,
      age: Math.round((Date.now() - state.createdAt) / 1000) + 's'
    });
  }
  return result;
}

/**
 * 清理所有待处理审批
 */
function clearAllApprovals() {
  for (const [id, state] of approvals.entries()) {
    clearTimeout(state.timeout);
    state.reject(new Error('服务重启，审批已清理'));
  }
  approvals.clear();
  console.log('[APPROVAL] 清理所有待处理审批');
}

// ============================================================
// 飞书正式审批 API 集成（lark-cli approval）
// ============================================================

const PROFILE = 'cli_a91d6fb107f8dbd8'; // 幻视应用 profile

/**
 * 查询我的待办审批任务
 * @param {object} options - 查询选项
 * @returns {Promise<Array>} 审批任务列表
 */
async function queryApprovalTasks(options = {}) {
  const { status = 'pending', pageSize = 20 } = options;

  try {
    const cmd = `lark-cli approval tasks query --status "${status}" --page-size ${pageSize} --as bot --profile ${PROFILE}`;
    const { stdout } = await execAsync(cmd);
    const result = JSON.parse(stdout);

    if (result.ok && result.data?.tasks) {
      console.log(`[APPROVAL API] 查询到 ${result.data.tasks.length} 个待办任务`);
      return result.data.tasks;
    }
    return [];
  } catch (err) {
    console.error(`[APPROVAL API] 查询任务失败: ${err.message}`);
    return [];
  }
}

/**
 * 同意审批任务
 * @param {string} taskId - 审批任务 ID
 * @param {string} comment - 审批意见（可选）
 * @returns {Promise<boolean>} 是否成功
 */
async function approveTask(taskId, comment = '') {
  try {
    let cmd = `lark-cli approval tasks approve --task-id "${taskId}" --as bot --profile ${PROFILE}`;
    if (comment) {
      cmd += ` --comment "${comment}"`;
    }
    const { stdout } = await execAsync(cmd);
    const result = JSON.parse(stdout);

    if (result.ok) {
      console.log(`[APPROVAL API] 审批通过: ${taskId}`);
      return true;
    }
    console.error(`[APPROVAL API] 审批失败: ${JSON.stringify(result)}`);
    return false;
  } catch (err) {
    console.error(`[APPROVAL API] 审批出错: ${err.message}`);
    return false;
  }
}

/**
 * 拒绝审批任务
 * @param {string} taskId - 审批任务 ID
 * @param {string} reason - 拒绝理由
 * @returns {Promise<boolean>} 是否成功
 */
async function rejectTask(taskId, reason = '') {
  try {
    let cmd = `lark-cli approval tasks reject --task-id "${taskId}" --as bot --profile ${PROFILE}`;
    if (reason) {
      cmd += ` --reason "${reason}"`;
    }
    const { stdout } = await execAsync(cmd);
    const result = JSON.parse(stdout);

    if (result.ok) {
      console.log(`[APPROVAL API] 审批拒绝: ${taskId}`);
      return true;
    }
    console.error(`[APPROVAL API] 拒绝失败: ${JSON.stringify(result)}`);
    return false;
  } catch (err) {
    console.error(`[APPROVAL API] 拒绝出错: ${err.message}`);
    return false;
  }
}

/**
 * 获取审批实例详情
 * @param {string} instanceId - 审批实例 ID
 * @returns {Promise<object|null>} 审批实例信息
 */
async function getApprovalInstance(instanceId) {
  try {
    const cmd = `lark-cli approval instances get --instance-id "${instanceId}" --as bot --profile ${PROFILE}`;
    const { stdout } = await execAsync(cmd);
    const result = JSON.parse(stdout);

    if (result.ok && result.data?.instance) {
      return result.data.instance;
    }
    return null;
  } catch (err) {
    console.error(`[APPROVAL API] 获取实例失败: ${err.message}`);
    return null;
  }
}

/**
 * 抄送审批实例
 * @param {string} instanceId - 审批实例 ID
 * @param {Array<string>} userIds - 用户 open_id 列表
 * @returns {Promise<boolean>} 是否成功
 */
async function ccApprovalInstance(instanceId, userIds) {
  try {
    const usersStr = userIds.join(',');
    const cmd = `lark-cli approval instances cc --instance-id "${instanceId}" --user-ids "${usersStr}" --as bot --profile ${PROFILE}`;
    const { stdout } = await execAsync(cmd);
    const result = JSON.parse(stdout);

    if (result.ok) {
      console.log(`[APPROVAL API] 抄送成功: ${instanceId}`);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[APPROVAL API] 抄送出错: ${err.message}`);
    return false;
  }
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  // 本地审批管理
  createApproval,
  resolveApproval,
  waitForApproval,
  getPendingCount,
  getPendingApprovals,
  clearAllApprovals,

  // 飞书审批 API
  queryApprovalTasks,
  approveTask,
  rejectTask,
  getApprovalInstance,
  ccApprovalInstance
};
