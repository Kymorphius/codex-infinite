# Claude 终端会话的模型与推理强度由记录决定，运行中通过空闲时输入斜杠命令切换

- Status: accepted
- Date: 2026-09-29
- Deciders: 项目维护者
- Related specs: docs/specs/2026-09-29-claude-terminal-model-effort.md

## Context

ADR 0042 把权限模式定为看板启动的 Claude CLI 进程的属性，`docs/adr/2026-09-28-claude-session-takeover.md` 规定了 resume / attach / 接管的启动契约。用户需要按会话选择模型、推理强度与 Ultracode，并跨 resume 保持。Claude CLI 2.1.284 有 `--model`、`--effort`，没有 Ultracode 参数；运行中的进程只能通过 TUI 斜杠命令修改。控制台此前从不主动向用户的 Claude 输入行写命令（讨论转发除外，且仅在空闲时）。

## Decision

1. 终端会话记录增加可选 `claudeSettings { model, effort, ultracode, updatedAt }`，作为下一次启动的权威来源。启动 / resume 在 `--resume` / `--session-id` 之前加入 `--model <cliModel>` 与（非自动时）`--effort <level>`；`opusplan` 固定两个版本环境变量，与 Router 一致。`claude attach` 与伴生会话的启动契约不变，其设置在看板中只读。
2. 运行中修改通过写 PTY 的 `/model`、`/effort` 命令实现，且仅当该会话的所有 Claude 持有者都登记为 `idle`（`waiting`：菜单 / 对话框 / 提示打开，`shell`、`busy` 都不算）、输入行自上次真正的提交（不含续行、Meta+Enter、`@` 补全接受）后无输入、并静默 1.5 秒时发送；粘贴后回车前若有新输入则不按回车。否则每会话排队一份最新目标。Ultracode 在每次启动后首次空闲时由同一机制恢复。选择更新与启动、停止串行。
3. 用户在 Claude 内的改动从会话记录读回，只采纳晚于 `updatedAt` 的观察；明确的 `/model` 精确映射并覆盖别名，解析后的回复模型 ID 不覆盖能解释它的别名。会话被其他 Claude 进程持有时选择器只读。读回写入不改变记录的 `updatedAt`。
4. `claudeSettings.model` 可为 `null`（沿用 Claude 默认，不传 `--model`）。已存设置宽松读取：目录外模型丢弃该字段，非法强度降为 `auto`，不使注册表整体不可读。

## Alternatives considered

- 只在下次启动生效（改设置需重启）：打断会话并丢失 Ultracode，放弃。
- 以会话记录为唯一来源、选择器只发命令：新会话无记录可读，Ultracode 无法恢复，放弃。
- 运行中改设置时自动 stop + resume：会中断进行中的回合与未发送输入，放弃。
- 读取 TUI 屏幕内容判断输入行：依赖渲染细节且不可靠，改用输入帧跟踪（保守地把任何未提交输入视为不安全）；菜单与对话框改由 Claude 自己登记的 `waiting` 状态排除。
- 以已存记录校验目录成员并在不符时拒绝整个注册表：任何目录调整都会让所有终端会话不可读（503），放弃，改为宽松读取。

## Consequences

- 首次引入由看板自动写入用户交互式 Claude 输入行的行为；安全规则见 spec，保守失败（不确定即排队）。
- 同一 PTY 的讨论转发直接写 PTY、未经过输入跟踪，两者理论上可能在 150ms 窗口内交错；二者都要求 Claude 空闲，且转发提交后 Claude 转为忙碌，风险低但存在。
- 依赖 Claude 会话登记的 `status` 字段（2.1.284：`busy` / `idle` / `shell` / `waiting`）与会话记录中 `effort`、`message.model`、`<command-name>` 的格式；格式变化时同步与空闲判断会失效为「不发送 / 不同步」，不会误发。若 Claude 将来在菜单或对话框打开时仍登记 `idle`，输入帧规则是剩下的唯一保护（它把菜单内的 Enter 视为提交），需要重新评估。
- 回滚到不认识该字段的旧版本前，需要从 `terminal-conversations.json` 删除 `claudeSettings`，否则旧版本会拒绝整个注册表（保留原文件，返回 503）。

## Supersedes / superseded by

扩展 ADR 0042 与 2026-09-28 接管 ADR 的启动契约，不取代它们。
