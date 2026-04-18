# Qoder CLI 飞书事件处理器

自动监听飞书消息并触发 Qoder CLI 响应。

---

## 📁 文件结构

```
~/.qoder/qodercli-feishu-bot/
├── config.json        # 配置文件
├── server.js          # 事件处理器主程序
├── start.sh           # 启动脚本
├── run-daemon.sh      # 守护进程管理
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
```

---

## 📋 配置说明

### config.json

```json
{
  "feishu": {
    "enabled": true,
    "connectionMode": "lark-cli",
    "eventTypes": ["im.message.receive_v1"]
  },
  "qoder": {
    "command": "qodercli",
    "args": ["-p", "--model", "qmodel"]
  }
}
```

| 字段 | 说明 |
|------|------|
| `feishu.connectionMode` | 使用 `lark-cli` 作为事件源（已配置认证） |
| `feishu.eventTypes` | 监听的事件类型 |
| `qoder.command` | Qoder CLI 命令 |
| `qoder.args` | 运行参数（`-p` 为非交互式单次提问） |

### 可用模型

| 模型选项 | 说明 |
|---------|------|
| `qmodel` | 千问系列模型 |
| `q35model` | 千问 3.5 模型 |
| `gmodel` | GLM 模型 |
| `kmodel` | Kimi 模型 |
| `mmodel` | MiniMax 模型 |
| `ultimate` | 最强模型 |
| `auto` | 自动选择 |

---

## 🔍 工作原理

1. **事件监听** - 使用 `lark-cli event +subscribe` 建立 WebSocket 长连接
2. **消息过滤** - 只处理私聊和 @ 消息
3. **触发响应** - 收到消息后启动 Qoder CLI 处理
4. **去重机制** - 5 分钟内不重复处理同一消息

---

## 📄 日志位置

- 运行日志：`~/.qoder/qodercli-feishu-bot/feishu-event.log`
- 查看日志：`tail -f ~/.qoder/qodercli-feishu-bot/feishu-event.log`

---

## ⚠️ 注意事项

1. **依赖 lark-cli** - 确保已配置 `lark-cli auth login`
2. **依赖 qodercli** - 确保已安装 `npm install -g @qoder-ai/qodercli`
3. **消息类型** - 目前仅支持文本消息

---

## 🛠️ 故障排查

### 服务无法启动
```bash
# 检查 lark-cli 配置
lark-cli config show

# 检查 qodercli 安装
qodercli --version

# 检查 Node.js 版本
node --version

# 查看错误日志
tail -50 ~/.qoder/qodercli-feishu-bot/feishu-event.log
```

### 收不到消息
1. 确认飞书机器人已添加到聊天
2. 检查事件订阅权限（飞书开放平台）
3. 查看日志确认 WebSocket 连接状态

---

## 📞 技术支持

配置参考：OpenClaw 飞书集成 (`~/.openclaw/openclaw.json`)
