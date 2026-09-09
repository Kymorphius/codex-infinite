# Hermes 内的 GPT 共享会话

目标是从 Hermes 原生项目列表、消息区和输入框继续原来的 GPT 会话。历史附件选择器与 Dashboard 内的额外 Chat 区域已退役。

Personal Panel 的桌面连接适配器读取本机原生项目目录及会话历史，向 Hermes 提供带 `codex:` 来源标识的项目和会话。发送通过原生 GPT 桌面完成，数据仍由原来的会话持有；不存在导入队列或重复的 Hermes 会话记录。Hermes 自有会话仍走 Hermes 后端。

本仓库提供 `hermes-shared-source.mjs` 与固定方法的 Node 工作进程；Personal Panel 持有可信 renderer IPC 与原生连接适配。既有只读 GPT 上下文 MCP 查询仍可用于研究，但不承担共享会话的发送或历史存储。

原始模型、审批、登录及执行权限由 GPT 会话负责。尚未适配的附件、设置和管理操作明确拒绝，不能回退创建另一条 Hermes 会话。详见 [共享会话规格](specs/2026-09-09-hermes-shared-conversations.md)。

本机双端文本续聊、自动历史刷新、停止及 Hermes 自有会话均已通过实机验证。共享会话约每 2 秒检查变化；附件和管理操作的边界见规格。
