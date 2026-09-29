# Claude 终端会话的模型 / 推理强度 / Ultracode 选择

- Status: accepted
- Owner: 项目维护者
- Date: 2026-09-29
- Related ADRs: docs/adr/0042-managed-claude-terminal-permission-mode.md, docs/adr/2026-09-28-claude-session-takeover.md, docs/adr/2026-09-29-claude-terminal-model-effort.md

## Problem

看板托管的 Claude 终端会话（kind `claude`）的启动命令只有会话 ID、resume、attach 与权限参数，没有模型和推理强度；终端输入框里也没有原生输入框那样的模型选择。用户只能在 Claude 里手打 `/model`、`/effort`，而且每次 resume 都回到 Claude 默认值，`/effort ultracode` 只对当前进程有效，resume 后丢失。现有的 Claude 设置面板属于原生 Codex 会话（`native-claude-preview.mjs:64` 在终端视图中不工作），终端会话也不能写原生模型设置（`docs/architecture.md:20-22`）。

## Goals

- 终端输入框底部出现与原生输入框同风格的模型 · 强度胶囊，向上弹出菜单（外观同「更多按键」/最近会话菜单），可选模型、强度（自动/轻度/中/高/极高/最高）与 Ultracode 开关。
- 选择按会话保存在服务端终端会话记录里；启动 / resume 时带 `--model`、`--effort`。
- 会话运行中修改：只在 Claude 空闲且安全时往 PTY 打 `/model`、`/effort`；忙时排队（每会话只留最新一份），空闲后发送。
- Ultracode 没有 CLI 参数：启动或 resume 后 Claude 第一次空闲时，若记录为开启，自动发送一次 `/effort ultracode`。
- 用户直接在 Claude 里改了模型或强度时，从 Claude 会话记录读回并同步到记录和选择器，但不能回滚刚在选择器里做的选择。

## Non-goals

- 不改 Router 伴生会话（`companionOf`）与 `claude attach` 共享打开的后台会话的模型：两者在选择器中只读。会话正被其他 Claude 进程持有（其他终端窗口或未在此打开的后台任务）时同样只读：此处无法输入命令，那个进程的回复也会在读回时覆盖刚做的选择。
- 不提供任意模型 ID 输入；不猜测 Claude 未公开的配置文件。
- 不改 Shell 终端、原生 Codex 会话或 Router 设置面板。
- 不在已运行的会话里为 `opusplan` 补设版本固定环境变量（只能在启动时设置）。

## User experience

- 位置：终端输入框底部，状态文字之后、发送按钮之前（原生输入框也把模型选择放在发送键左侧）。仅 Claude 会话显示。
- 胶囊文字：`Opus 5.5 · 高`，开启 Ultracode 时追加 `· Ultracode`；记录没有设置时显示从会话记录读回的实际值，都没有时显示 `Claude 默认`。记录的模型未设置（`null`，见下）时显示 `Claude 默认 · 高`。
- 菜单（`role=menu`，向上弹出，12px 圆角，行 8px 圆角、悬停 9% 前景色）：
  - 「模型」：固定版本 Opus 5.5 / Sonnet 5.5 / Haiku 4.5 / Fable 5.1 / Opus 5.5 规划 + Sonnet 5.5 执行；「别名（随 Claude 更新）」：默认、best、opus、sonnet、haiku、opusplan、opus[1m]、sonnet[1m]。行为 `menuitemradio`，上下方向键移动焦点。
  - 「推理强度」：分段按钮 `radiogroup`，左右方向键切换；只能自动的模型（Haiku 4.5、默认、best、Haiku 最新）强度固定为自动并停用。
  - 「Ultracode」开关（`menuitemcheckbox`），说明「仅本会话；恢复时自动重新开启」。
  - 底部提示：停止时「下次启动时生效」；运行中「Claude 空闲时切换」；已排队「等待 Claude 空闲且输入行为空后切换」；只读时说明原因（伴生 / attach / 其他 Claude 进程）。
- 每次选择立即保存（带 `expectedRevision`）；只改被点的那一项（模型、强度或 Ultracode），其余取当前显示值；当前没有已知模型时模型保持未设置，不会因为只改强度或 Ultracode 而固定成某个模型。409 时读取最新记录，把同一项改动叠加到最新值上再重试一次（不重发旧的整份设置，避免覆盖刚从 Claude 读回的改动）；其他错误显示在菜单底部。
- 保存期间控件只标 `aria-disabled` 并忽略输入，不设 `disabled`，焦点留在原控件，键盘可继续使用。键盘处理挂在胶囊与菜单的共同容器上：菜单打开时 Esc 总能关闭（包括鼠标打开、焦点仍在胶囊时），焦点回到胶囊；胶囊上的上下方向键打开菜单并聚焦选中行。页面任意位置（输入框、移到原生标题栏的按钮、原生侧栏）的点击或窗口失焦都会关闭菜单。
- 胶囊的最大宽度（`min(280px,42vw)`，窄屏 150px）放在可收缩的容器上，胶囊本身 `max-width:100%`，文字按实际可用宽度省略，不会盖住发送按钮。

## Contracts and data

- 终端会话记录新增可选字段 `claudeSettings: { model, effort, ultracode, updatedAt }`，只用于 `kind: "claude"`。旧记录没有该字段仍通过校验，注册表 `version: 1` 不变。
- 读取已存记录时宽松解析，目录变化不会让注册表整体不可读：形状不对、`updatedAt` 无效或模型已不在目录中时丢弃该字段（等同未设置）；强度不在列表中或模型已变为只能自动时改为 `auto`；Shell 记录上的该字段被丢弃。严格校验只用于 `update` 输入。
- `update` 输入新增可选 `claudeSettings: { model, effort, ultracode }`（服务端写入 `updatedAt`）。`model` 为目录中的 ID 或 `null`（未设置：不传 `--model`、不发 `/model`，沿用 Claude 自己的默认），`effort` ∈ `auto, low, medium, high, xhigh, max`，只能自动的模型必须是 `auto`，`ultracode` 为布尔值。Shell 会话 400；伴生会话、attach 运行中的会话、被其他 Claude 进程持有的会话 409。含 `claudeSettings` 的更新与 `start` / `stop` 串行（同一会话的 `exclusive` 队列），启动中做的选择会在启动完成后排队给新启动的 Claude。
- 视图（list/open/start/update 返回）新增：`claudeObserved`（从会话记录读回的 `{model, effort, ultracode}`，只读展示）、`claudeSettingsPending`（有排队未发送的切换）、`claudeSettingsReadOnly`（`companion` / `attach` / `elsewhere` / `null`）。
- 看板投影 `model` / `reasoningEffort` 取记录的 CLI 模型 ID 与强度（自动为 `null`）。
- 模型目录镜像 `../jev-codex-router/src/claude-subscription-model.mjs` 的 12 个 family（名称、CLI ID、只能自动集合），另加 `fable`（Fable 5.1，`claude-fable-5-1`）。`auto` 不传 `--effort`。

## Design and ownership

- `src/claude-terminal-settings.mjs`（领域，无 DOM/进程/文件依赖）：目录（自包含函数，也注入页面）、输入与记录校验、启动参数与 `opusplan` 环境变量、从当前到目标的斜杠命令序列、观察到的模型字符串到目录 ID 的映射。
- `src/claude-transcript-settings.mjs`（领域）：从 Claude 会话记录行提取观察值，合并续接链，并按「只采纳比 `updatedAt` 新的观察」规则得出要同步的设置。`claude-transcript.mjs` 只负责调用它并在 summary 中返回 `settings`。
- `src/terminal-input-line.mjs`（领域）：按 PTY 输入帧判断输入行是否可能有未提交内容。`TerminalService` 在收到输入帧与服务端写入时更新它，提供 `inputLine(id)`（`{ dirty, at, seq }`）与返回写后状态的 `write(id, data)`。
- `src/claude-terminal-settings-apply.mjs`（应用服务）：每会话一份排队目标、空闲轮询、写 PTY、Ultracode 恢复、最近写入后的同步静默期。
- `src/terminal-conversation-service.mjs`：启动时把记录设置交给启动参数、登记 applier；`update` 在会话的串行队列中校验只读条件（含其他进程持有）并排队；`view` 做读回同步，经 `TerminalConversationStore.update(..., { touch: false })` 写回。
- `src/terminal-process.mjs`：`terminalLaunch` 在 `--resume` / `--session-id` 之前加入 `--model`、`--effort`，POSIX 下用单引号转义，所有平台拒绝不在安全字符集内的模型字符串；attach 不变。
- UI：`src/native-terminal-model-picker.mjs`（注入的选择器，只消费归一化视图并通过既有 `update` 请求保存）与 `src/native-terminal-model-picker-style.mjs`（独立样式）；`native-terminal-view.mjs` 只挂载；`native-terminal-runtime.mjs` 注入。

### 空闲与安全规则（运行中切换）

仅当以下全部成立时才往 PTY 写一条命令，每条命令前重新检查：

1. 会话由本看板启动并在运行，且不是 attach；
2. Claude 在 `~/.claude/sessions/<pid>.json` 的登记状态为 `idle`，且该会话链的每个持有者都是 `idle`（与「最近会话」同源）。Claude 2.1.284 的登记状态有 `busy`、`idle`、`shell`、`waiting` 四种（二进制中 `["busy","shell","idle","waiting"]`）：回合进行中为 `busy`；打开本地命令界面（`/model`、`/resume`、`/config` 等菜单，「dialog open」）、权限 / 提问 / 计划确认等对话框（`topDialogWaitingFor`）、elicitation 与 worker/sandbox 请求时为 `waiting`；bash 模式为 `shell`。这些状态以及状态缺失都视为「不空闲」，所以菜单或对话框打开时不会输入，回车也不会选中其中的选项。启动时的信任 / 权限提示在 REPL 登记之前出现，此时没有 `idle` 登记，同样不写；
3. 输入行干净：自上次提交以来 PTY 没有收到会留在输入框里的输入。只有这些算作提交：不在括号粘贴内、前一个字符不是 `\`、前面不是 ESC（包括上一帧末尾单独的 ESC）、当前最后一个词不是 `@` 提及的裸 `\r`；⌘Enter 发送的 `\x18\x13`；以及 `\x03`（Ctrl-C，Claude 会清空输入）。`\` + Enter（续行）、Option/Meta+Enter（`\x1b\r`）、括号粘贴内的回车、`@文件` 补全时用 Enter 接受建议都只是编辑，输入行仍有内容；接受 `@` 建议后的下一次 Enter 才算提交。其他任何字节（文字、粘贴、方向键、Esc、删除）都视为「有未提交内容」。终端自动发送的焦点 / 鼠标报告与查询回复（DA1、DA2 `ESC[>…c`、光标位置、DECRPM、kitty 键盘标志 `ESC[?…u`、OSC 颜色）不算输入；
4. 距最后一次输入帧（含本服务写入）至少 1.5 秒，覆盖 Claude 更新忙闲登记的延迟与用户连续输入；并且读取登记期间没有新的输入帧到达（按输入帧计数比较）。

写法与讨论转发一致：括号粘贴命令文本，150ms 后 `\r`。回车前再核对输入帧计数：粘贴后若有人输入，就不按回车（粘贴的文字留在输入框里，由用户自行处理），该步保持排队，等输入行再次干净后重试。每次只发一条命令，发完后下一条同样要等 1.5 秒静默（本服务的回车也算一次输入），即两条命令至少相隔 1.5 秒。不满足时每秒重查；每会话只保留最新目标（后选覆盖先选）；运行时停止或被替换即丢弃（下次启动由启动参数生效）；旧运行时遗留的一次执行在写入失败或等待后发现状态已被替换时，只结束自己，不会清掉新运行时的排队与 Ultracode 恢复。命令序列从「运行中已知设置」算到目标：模型变化发 `/model <cliModel>`，强度变化发 `/effort <level>`（自动为 `/effort auto`），Ultracode 变化发 `/effort ultracode` 或 `/effort ultracode off`；Ultracode 开启且强度改变时再补发一次 `/effort ultracode`。

### 读回同步规则

- 从会话记录（续接链上所有文件，取各项最新）读取：最后一条主会话 assistant 的 `message.model`（仅 `claude-*`）与 `effort`，最后一条 `/model`、`/effort` 本地命令的参数（含 `ultracode`、`ultracode off`）及时间戳。
- 大文件（超过全量扫描阈值）从尾部回填时，要找到全部四类证据（assistant、`/model`、`/effort`、ultracode）或达到回填上限才停止：自动强度下，最后一条回复之前的 `/effort` 仍然有效。
- 仅对已有 `claudeSettings` 的非伴生记录同步，且只采纳时间晚于 `claudeSettings.updatedAt` 的观察；有排队目标或 10 秒内刚写过命令时不同步，避免把尚在进行的旧回合或尚未落盘的命令当成用户改动。选择器在会话被其他 Claude 进程持有时只读，因此不会出现「刚在此处选择、却被外部进程的旧模型回复覆盖」的情况；在此处停止后于外部 `claude --resume` 使用其他模型，属于用户在 Claude 中的改动，照常读回。
- 观察按时间顺序折叠：
  - `/model` 参数只做精确映射（先匹配当前选择的 CLI ID，使 `/model opus` 保持 `opus-latest`；再匹配目录 CLI ID / ID），明确输入的模型总会覆盖别名选择（包括 `default`、`best`、`opus[1m]`）；不在目录中的版本无法表示，保持原选择。
  - assistant 的解析后模型 ID（如 `claude-opus-5-5`）：当前选择是别名或 `opusplan`（CLI ID 不以 `claude-` 开头）且同系（或 `default`、`best` 的通配）时保持当前选择；固定版本只认自己的 ID；否则改为 CLI ID 完全相同的固定版本，未知模型忽略。模型未设置（`null`）时回复不改变它（Claude 默认可以解释任何回复），只有 `/model` 会设置。
  - `/effort <级别>` 设置强度并关闭 Ultracode（与 applier 的假设一致：新级别结束 Ultracode，因此 applier 在 Ultracode 开启时改强度会再发一次 `/effort ultracode`）；之后的 `/effort ultracode` 再打开。当前强度为自动时忽略 assistant 的解析后强度。只能自动的模型强制为自动。
- 采纳结果以观察时间为新的 `updatedAt` 写回记录（版本冲突则放弃，下次再试），同时更新 applier 的已知设置并清除排队。读回写入只增加记录版本，不改变记录自身的 `updatedAt`，会话在列表中的位置不变；版本增加可能使同时进行的改名等操作收到「会话已变更」，选择器会读取最新记录后重试。没有 `claudeSettings` 的旧记录只在视图 `claudeObserved` 中展示，不写记录，也不改变其启动参数。

## Security and privacy

- 只读 `~/.claude/projects` 下托管会话的记录与 `~/.claude/sessions` 登记（已有读取器），不读设置或凭证。
- 写入 PTY 的只有目录内固定的命令文本；模型值只来自目录，启动命令中额外校验字符集并转义。
- 不放宽回环、同源、只读索引等不变量；HTTP 与原生绑定沿用既有 `update` 路径和 8 KiB 限制。

## Rollout and rollback

- 旧记录无需迁移；未设置的会话启动命令与此前完全相同。以后调整模型目录（删除或改名模型、改只能自动集合）不会让注册表不可读，受影响的记录按上文宽松解析降级。
- 回滚：移除字段读取即可；已写入 `claudeSettings` 的注册表在旧版本上会因未知字段被拒绝，回滚前需删除该字段（记录在 ADR）。

## Acceptance criteria

- [x] 选择器在 Claude 会话显示、在 Shell 会话不显示；伴生 / attach 会话只读。
- [x] 选择持久化到记录，旧记录仍可读取；非法模型、强度与只能自动的冲突被拒绝。
- [x] 启动 / resume 命令带 `--model`、`--effort`（自动不带），位于 `--resume` / `--session-id` 之前；attach 不带；不安全模型字符串被拒绝。
- [x] 运行中切换只在空闲（所有持有者登记为 `idle`）、输入行干净、静默 1.5 秒后发送；续行、Meta+Enter、`@` 补全接受不算提交；回车前有新输入则不按回车；忙时排队且后选覆盖先选。
- [x] 被其他 Claude 进程持有时选择器只读、`update` 返回 409；启动中做的选择在启动后排队。
- [x] 已存设置宽松读取：目录外模型或非法强度不会让注册表不可读。
- [x] Ultracode 开启的会话在启动后首次空闲时发送一次 `/effort ultracode`。
- [x] 读回同步只采纳比选择更新的观察，别名不被解析后的模型 ID 覆盖。
- [x] 看板投影填充模型与强度。

## Verification plan

- Unit: `claude-terminal-settings`、`claude-transcript-settings`、`terminal-input-line`、`claude-terminal-settings-apply`、`terminal-process` 启动参数。
- Integration: `terminal-conversation-service` 启动参数、更新只读条件、运行中排队、读回同步；`claude-transcript` summary 返回观察值；投影。
- Real UI: vm + 假 DOM 测选择器结构、开合、方向键、只读、自动强度停用与保存请求；运行时注入测试确认安装。在真实 Codex 窗口里 resume 一个会话确认参数生效（需人工）。
- Structure and regression: `npm run check`、`npm test`。

## Shipped deviations

- 未在真实 Claude 2.1.284 TUI 中端到端验证 `/effort auto`、`/effort ultracode off` 与括号粘贴斜杠命令的行为；规则按调研记录的格式实现，需人工在真实窗口验收。登记状态 `waiting` / `shell` 的触发条件、`/effort` 帮助文本（「Ultracode (any effort level, this session only)」「Ultracode off」「Set effort level to」）取自 2.1.284 二进制中的字符串，未在真实窗口逐项复现。
- 同一二进制的文本显示 `/effort <级别>` 可能把级别「saved as your default for new sessions」；如属实，运行中切换强度也会改变用户在其他新会话中的默认强度。另外 Claude 有 `ultracode` 设置键（`--settings` / apply_flag_settings），可作为日后替代「首次空闲时输入 `/effort ultracode`」的启动方式；本次未采用，保持用户确认的方案。
