# Qoder CLI 飞书机器人

飞书长连接 + 交互式卡片 + 审批功能集成 Qoder CLI。

---

## 📁 文件结构

```
~/.qoder/qodercli-feishu-bot/
├── server.js          # 主服务（WebSocket 监听 + 事件处理）
├── card.js            # 飞书交互式卡片 JSON 构建器
├── approval.js        # 审批管理模块（本地状态 + 飞书 API）
├── run-daemon.sh      # 守护进程管理脚本
├── package.json       # Node.js 依赖
└── README.md          # 本文档
```

---

## 🚀 快速启动

```bash
# 启动服务
~/.qoder/qodercli-feishu-bot/run-daemon.sh start

# 查看状态
~/.qoder/qodercli-feishu-bot/run-daemon.sh status

# 停止服务
~/.qoder/qodercli-feishu-bot/run-daemon.sh stop

# 重启服务
~/.qoder/qodercli-feishu-bot/run-daemon.sh restart

# 查看日志
tail -f ~/.qoder/qodercli-feishu-bot/feishu-event.log
```

---

## 📋 配置说明

### 飞书应用配置

- **应用名称：** 幻视
- **App ID：** `cli_a91d6fb107f8dbd8`
- **Profile：** `cli_a91d6fb107f8dbd8`（在 `~/.lark-cli/config.json` 中配置）

### lark-cli 多应用共存

```json
// ~/.lark-cli/config.json
{
  "apps": [
    {
      "appId": "cli_a91b8b28d1f8dbc4",  // 无极（Claude 使用）
      "appSecret": { "source": "keychain", "id": "appsecret:cli_a91b8b28d1f8dbc4" },
      "brand": "feishu",
      "lang": "zh"
    },
    {
      "appId": "cli_a91d6fb107f8dbd8",  // 幻视（Qoder 使用）
      "appSecret": "Gv3j57n4povYEnSEnzBPJfBXTvgF8PlI",
      "brand": "feishu",
      "lang": "zh"
    }
  ]
}
```

**重要：** 两个机器人使用不同的飞书应用，通过 `--profile` 参数隔离，互不干扰。

### 可用模型

| 模型选项 | 说明 |
|---------|------|
| `qmodel` | 千问系列模型（默认） |
| `q35model` | 千问 3.5 模型 |
| `gmodel` | GLM 模型 |
| `kmodel` | Kimi 模型 |
| `mmodel` | MiniMax 模型 |
| `ultimate` | 最强模型 |
| `auto` | 自动选择 |

修改模型：在 `server.js` 的 `callQoder()` 函数中更改 `--model` 参数。

---

## 🎯 功能列表

### 1. AI 对话

在飞书群聊中发送任意文本消息，自动调用 qodercli 获取 AI 回复。

### 2. 交互式卡片按钮

| 命令 | 功能 |
|------|------|
| `审批测试` / `测试审批` | 发送测试卡片（同意/拒绝按钮） |
| `权限审批` / `申请权限` | 发送权限审批卡片并等待审批结果 |

### 3. 飞书正式审批流程

| 命令 | 功能 |
|------|------|
| `我的审批` / `审批任务` | 查询待办审批任务列表 |
| `同意审批 <任务ID>` | 同意指定审批任务 |
| `拒绝审批 <任务ID> <理由>` | 拒绝指定审批任务 |

### 4. 本地审批管理

| 命令 | 功能 |
|------|------|
| `待处理审批` / `审批列表` | 查看本地卡片回调的待处理审批 |

---

## 🔍 工作原理

### 架构

```
飞书平台
   |
   └── WebSocket 长连接 (lark-cli event +subscribe)
          |
          ├── im.message.receive_v1  →  AI 对话 + 卡片发送
          └── card.action.trigger    →  卡片按钮回调处理
```

### 启动命令

```bash
lark-cli event +subscribe \
  --as bot \
  --force \
  --event-types im.message.receive_v1,card.action.trigger \
  --profile cli_a91d6fb107f8dbd8
```

### 消息处理流程

1. **WebSocket 接收** - lark-cli 通过 WebSocket 接收飞书事件
2. **事件解析** - server.js 解析事件类型（消息/卡片回调）
3. **去重过滤** - 使用 Set 去重，防止重复处理
4. **命令分发** - 审批命令 → 卡片/审批 API，普通文本 → qodercli
5. **响应发送** - 通过 lark-cli 发送文本或卡片消息

### 卡片按钮回调流程

1. 用户点击卡片按钮
2. 飞书通过 WebSocket 推送 `card.action.trigger` 事件
3. server.js 解析 action value（approval_id, action 等）
4. 解析对应的 Promise（createApproval 创建时注册的）
5. 发送反馈消息到群聊

---

## 📄 日志

- **位置：** `~/.qoder/qodercli-feishu-bot/feishu-event.log`
- **查看：** `tail -f ~/.qoder/qodercli-feishu-bot/feishu-event.log`

---

## ⚠️ 注意事项

1. **依赖 lark-cli** - 确保已安装 `npm install -g @larksuite/cli`
2. **依赖 qodercli** - 确保已安装 qodercli
3. **Profile 隔离** - Qoder 使用 `--profile cli_a91d6fb107f8dbd8`，Claude 使用默认 profile
4. **WebSocket 唯一性** - 同一 App ID 只能有一个 WebSocket 订阅连接
5. **消息去重** - 5 分钟内不重复处理同一消息 ID
6. **审批超时** - 本地卡片审批默认 5 分钟超时

---

## 🛠️ 故障排查

### 服务无法启动

```bash
# 检查 lark-cli 配置
lark-cli config show --profile cli_a91d6fb107f8dbd8

# 检查 qodercli 安装
qodercli --version

# 检查 Node.js 版本
node --version

# 查看错误日志
tail -50 ~/.qoder/qodercli-feishu-bot/feishu-event.log

# 清理旧进程
pkill -9 -f "lark-cli.*subscribe"
pkill -9 -f "server\.js"
```

### 收不到消息

1. 确认飞书机器人已添加到群聊
2. 检查事件订阅权限（飞书开放平台 -> 事件与回调）
3. 查看日志确认 WebSocket 连接状态
4. 确认没有其他进程占用同一 App ID 的 WebSocket 连接

### 卡片按钮无回调

1. 确认事件订阅包含 `card.action.trigger`
2. 检查卡片 JSON 中的 `behaviors` 或 `value` 字段
3. 查看日志中的 `[CARD ACTION]` 条目

### 与 Claude 冲突

**问题：** 两个机器人共用同一飞书应用，WebSocket 连接冲突

**解决：** 为每个机器人创建独立的飞书应用，在 `~/.lark-cli/config.json` 中配置不同 profile

---

## 📦 依赖

```json
{
  "@larksuiteoapi/node-sdk": "^1.60.0",
  "axios": "^1.6.0",
  "dotenv": "^16.3.1",
  "express": "^4.22.1",
  "jsonwebtoken": "^9.0.3",
  "ws": "^8.20.0"
}
```

---

## 🔗 相关资源

- GitHub: https://github.com/jshaofa-ui/qodercli-feishu-chat
- 飞书开放平台: https://open.feishu.cn/
- lark-cli 文档: `lark-cli --help`
