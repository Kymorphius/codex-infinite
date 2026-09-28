# Claude 会话模型选择

原生会话输入框旁的 Claude 设置面板增加模型选择，显示并固定 Opus 5.5、Sonnet 5.5、Haiku 4.5，以及 Opus 5.5 规划 / Sonnet 5.5 执行。默认仍为 Opus 5.5；原有会话的 Opus 选择在读取时补全模型字段。左键继续在 GPT 与该会话上次选用的 Claude 模型之间切换，右键面板调整模型、推理强度及原生工具。

- 面板只提交 Router 已注册的订阅路由，不提供任意模型 ID 输入，也不静默回退到 GPT 或其他提供商。
- 原生会话设置桥接须允许面板能生成的每条 Claude 路由，同时继续拒绝未注册的斜杠模型 ID；桥接脚本升级要在现有窗口生效，不能停留在只识别 Opus 的旧闭包。
- 版本名对应 Router 启动官方 Claude CLI 时传入的固定 `--model` ID；路由名仍保持现有 `claude-subscription/<family>` 格式，以免破坏旧会话。
- Opus 与 Sonnet 保留自动、low、medium、high、xhigh、max 强度及原生工具开关。Haiku 4.5 不支持强度：面板将其固定为自动且停用强度选择；Router 不向 CLI 传 `--effort`。
- 混合模式交给官方 Claude CLI 的 `opusplan` 实现，仅进入 Claude 规划模式才用 Opus，其余执行用 Sonnet；Router 同时固定 `ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-5-5` 和 `ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-5-5`，避免别名升级后面板版本与实际模型不一致。自动推理强度与此模式可组合，不将其描述为按任务自动选模型。
- 面板另提供 Claude Code 原生别名：`default`、`best`、`opus`、`sonnet`、`haiku`、`opusplan`、`opus[1m]`、`sonnet[1m]`。它们与上方固定版本选项分开命名，界面明确写“随 Claude 更新”；`best` 显示“可能使用额外 usage credits”。`default`、`best`、`haiku` 的强度固定为自动；长上下文别名由 CLI 检查账号支持情况，不在本地伪装为已开通。别名不设置固定版本环境变量。
- 控制台服务重载后，原生窗口里已安装的旧 Claude 面板必须热替换其事件订阅和模型列表，不能只让旧闭包重绘；替换时保留当前会话与编辑中的输入。
- 原有成功回读和失败回滚逻辑覆盖模型切换；生成中的会话仍禁止改设置。偏好按会话保存，不保存凭证或对话文本。
- Fable 可能使用额外 usage credits，本次不加入无需确认的非交互式订阅路由。

验证选择持久化、旧偏好读取、模型与 CLI 参数映射、Haiku 强度隔离、原生工具模式、失败回滚和路由目录。运行项目规定的检查与测试。更新后的服务需要安全重载；服务运行中现有 Claude 终端和模型请求不得被重启打断。
