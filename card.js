/**
 * 飞书交互式卡片 JSON 构建器
 * 支持审批卡片、结果卡片、测试卡片等
 */

/**
 * 构建审批确认卡片
 * @param {object} options - 配置选项
 * @param {string} options.title - 卡片标题
 * @param {string} options.description - 说明内容（支持 Markdown）
 * @param {number} options.approvalId - 审批 ID
 * @param {string} options.approvalType - 审批类型: 'command' | 'permission' | 'general'
 * @param {string} [options.template='orange'] - 卡片颜色模板
 * @returns {object} 卡片 JSON 结构
 */
function buildApprovalCard(options) {
  const {
    title = '操作确认',
    description = '',
    approvalId,
    approvalType = 'general',
    template = 'orange'
  } = options;

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: title },
      template: template
    },
    elements: [
      {
        tag: 'markdown',
        content: description
      },
      {
        tag: 'hr'
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `审批类型: ${approvalType} | ID: ${approvalId}`
          }
        ]
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '同意' },
            type: 'primary',
            behaviors: [
              {
                type: 'callback',
                value: { approval_id: approvalId, action: 'approve', type: approvalType }
              }
            ]
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '拒绝' },
            type: 'danger',
            behaviors: [
              {
                type: 'callback',
                value: { approval_id: approvalId, action: 'reject', type: approvalType }
              }
            ]
          }
        ]
      }
    ]
  };
}

/**
 * 构建已处理的审批卡片（用于回调响应）
 * @param {string} choice - 用户选择: 'approve' 或 'reject'
 * @param {string} operatorName - 操作者名称
 * @param {string} [reason=''] - 操作理由
 * @returns {object} 已处理的卡片 JSON 结构
 */
function buildResolvedCard(choice, operatorName, reason = '') {
  const icon = choice === 'reject' ? '❌' : '✅';
  const label = choice === 'reject' ? '已拒绝' : '已同意';
  const template = choice === 'reject' ? 'red' : 'green';

  const elements = [
    {
      tag: 'markdown',
      content: `${icon} **${label}** by ${operatorName}`
    }
  ];

  if (reason) {
    elements.push({
      tag: 'note',
      elements: [{ tag: 'plain_text', content: reason }]
    });
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `${icon} ${label}` },
      template: template
    },
    elements: elements
  };
}

/**
 * 构建测试卡片
 * @returns {object} 测试卡片 JSON 结构
 */
function buildTestCard() {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '测试卡片按钮' },
      template: 'blue'
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'plain_text', content: '点击按钮测试 card.action.trigger 回调' }
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '点击测试' },
            type: 'primary',
            behaviors: [
              {
                type: 'callback',
                value: { test: 'ok', timestamp: Date.now() }
              }
            ]
          }
        ]
      }
    ]
  };
}

/**
 * 构建权限审批卡片
 * @param {object} options - 配置选项
 * @param {string} options.applicant - 申请人
 * @param {string} options.permission - 权限内容
 * @param {string} options.reason - 申请理由
 * @param {number} options.approvalId - 审批 ID
 * @returns {object} 卡片 JSON 结构
 */
function buildPermissionCard(options) {
  const { applicant, permission, reason, approvalId } = options;

  const description = `**权限审批申请**

**申请人：** ${applicant}
**申请权限：** ${permission}
**申请理由：** ${reason}`;

  return buildApprovalCard({
    title: '权限审批',
    description,
    approvalId,
    approvalType: 'permission',
    template: 'blue'
  });
}

/**
 * 构建命令执行审批卡片
 * @param {object} options - 配置选项
 * @param {string} options.command - 待执行的命令
 * @param {string} options.description - 操作说明
 * @param {number} options.approvalId - 审批 ID
 * @returns {object} 卡片 JSON 结构
 */
function buildCommandCard(options) {
  const { command, description, approvalId } = options;

  const cmdPreview = command.length > 300
    ? command.substring(0, 300) + '...'
    : command;

  const content = `**命令执行确认**

待执行命令:
\`\`\`
${cmdPreview}
\`\`\`

**说明：** ${description}`;

  return buildApprovalCard({
    title: '命令执行审批',
    description: content,
    approvalId,
    approvalType: 'command',
    template: 'orange'
  });
}

module.exports = {
  buildApprovalCard,
  buildResolvedCard,
  buildTestCard,
  buildPermissionCard,
  buildCommandCard
};
