# 伴生 Claude 会话显示在 Codex 会话下方

## 目标

Codex 会话选用 Router 的 Claude 订阅模型后，Router 会为这个线程维护一份持久的伴生 Claude CLI 会话。
在原生侧边栏里，这个 Codex 会话的正下方显示一行缩进的二级会话；点击它就以受管 Claude 终端会话打开，
直接 `claude --resume` 接着聊。两边共享同一份上下文，但同一时刻只有一边在说话。

## 数据来源

- Router 在 `STATE_DIR/claude-companions/<threadId>/session.json` 写入
  `{"version":1,"threadId","sessionId","state","updatedAt"}`（0600，原子替换）。这是 Router 公开给本机工具的唯一文件；
  `binding.json` 仍是 Router 私有，不读取。
- `src/claude-companion-source.mjs` 是适配器：只读列出 `routerStateDirectory/claude-companions` 下的有效摘要，
  拒绝符号链接、非规范目录名和超限文件；按 mtime 缓存，不做后台轮询。伴生会话的工作目录就是该线程目录。
- 领域层与界面层只看到规范化后的 `{ threadId, sessionId, cwd }`，不知道 Router 的文件格式。

## 会话记录

- 终端会话记录新增可选字段 `companionOf`（Codex 线程 UUID）。用户不能通过 create/update 设置它。
- 列表时，每个伴生摘要被收编为一条 `kind: 'claude'` 记录，记录 ID 等于 Claude CLI 会话 ID（与现有 Claude 终端会话一致），
  cwd 为伴生目录，标题跟随 Claude 自身标题。已存在的记录不改写；归档后保持归档。
- 命名：伴生会话是 Codex 会话的 Claude 一侧，标题跟随对应 Codex 会话的标题（`session_index.jsonl` 的
  `thread_name`，按文件变化缓存）；用户在终端里 `/rename` 过则用该名字；在看板里改过名则以看板为准。
  永不使用 Claude 生成的标题——伴生记录里的用户消息全是 Router 经 `claude -p` 转发的 Codex 提示词
  （`entrypoint: "sdk-cli"`，以 Codex 系统指令开头），生成的标题会描述这些提示词。
- 「发送」只算人在终端里亲手输入的消息：所有 Claude 记录读取时都跳过 `entrypoint: "sdk-cli"` 的用户消息。
  因此只在 Codex 里聊时，伴生会话没有发送时间，不进最近发送（那条消息已经是 Codex 行），消息搜索也不会命中 Codex 指令。
  在伴生终端里说过话后，它按那次时间进入最近发送，标题同 Codex 会话，说明为「时间 · Claude 伴生」；
  最近会话里说明为「Claude 伴生」；状态图标与其他 Claude 会话一致。
- Router 换用新的 Claude 会话后（`session.json` 的 `sessionId` 变化），旧伴生记录保留但不再出现在列表、
  侧边栏、菜单和消息搜索中；伴生来源读取失败时不做隐藏。

## 轮流占用

两个同时运行的 Claude 进程写同一会话会分叉：常驻终端看不到之后的 Codex 轮次，Codex 下一轮也可能接不到终端里的新消息（已实测）。因此：

- Codex 一轮进行中：Router 的 `claude -p` 进程在 `~/.claude/sessions` 登记为 `entrypoint: "sdk-cli"`。
  终端会话视图把它显示为被 Codex 占用（只读），启动请求返回 409；**接管也不可用**，不能结束 Codex 正在进行的轮次。
- 终端正在运行：Router 在续接前检查同一登记表，拒绝这一轮并返回 409 `CLAUDE_SESSION_OPEN`，提示在终端退出后再发送。
- 每次打开终端都从最新记录恢复，因此 Codex 里做过的事终端都能看到，反之亦然。

## 界面

- 放置：找到 `[data-app-action-sidebar-thread-id="local:<threadId>"]`，沿只有一个子元素的包装层向上到列表项，
  把伴生行插在该列表项之后。该线程行不在 DOM 中（项目折叠、未加载）时不显示。
- 样式：左缩进、`↳` 标记、`CLI` 引擎标签和运行状态点，沿用现有终端侧边栏行的菜单与点击行为。
  伴生行位于 `[data-ccc-terminal-sidebar]` 内，原生导航拦截不会把它当作原生会话行。
- 默认折叠：伴生行默认不显示；有伴生的 Codex 会话行左侧缩进空白处显示一个琥珀色展开箭头（属于伴生容器，
  不插入原生行，避免被 React 重渲染冲掉）。点击展开或收起，展开的线程记在本机 `localStorage`
  （`codex-control-console.companion-expanded.v1`，仅为个人偏好，读取失败按折叠处理）。

## 顺带修正

Claude 预览按钮改用 Router 的新模型 ID `claude-subscription/opus`，强度增加 xhigh 与 max；旧 ID 仍被接受，
已保存的旧选择可以恢复。

## 验收

- 适配器、合同、收编、占用区分（sdk-cli 不可接管）与侧边栏放置均有专项测试。
- `npm run check` 与 `npm test` 通过；并发改动造成的无关失败需单独说明，不能宣称全量通过。
- 实际界面由用户在增强版窗口中回读确认；本变更不自动切换模型、不发送消息、不结束任何 Claude 进程。

## 工作目录与项目搜索（2026-09-28）

- Router 现在让伴生 Claude 在对应 Codex 会话的项目目录工作，`session.json` 公开 `cwd`（Router 状态文件仍在私有伴生目录）。
  适配器采用经 `realpath` 校验、真实存在的绝对目录；缺失或无效时沿用伴生目录，兼容旧摘要。
- 已收编的伴生记录随 `session.json` 的 `cwd` 迁移（`relocateCompanion` 只改伴生记录的 `cwd`，版本号加一，未变化时不写盘）。
  Claude 能从任意目录按会话 ID 续接，所以看板在新目录恢复同一会话。
- 项目搜索结果与侧边栏一致：有伴生的 Codex 会话行左侧显示同一个琥珀色展开箭头，默认折叠，展开后在其下显示 `↳` 伴生行；
  展开状态与侧边栏共用同一个本机偏好键。伴生记录没有项目引用，只出现在对应会话下，不会作为项目下的独立终端行重复出现。

## 从会话右键菜单新建伴生会话（2026-09-28）

- 在原生侧边栏右键本机 Codex 会话，打开的原生菜单末尾追加一项（样式复制原生菜单项，原生项不改）：
  没有伴生时为「新建伴生 Claude 会话」，已有时为「打开伴生 Claude 会话」。只挂到右键线程行后 2 秒内打开的菜单；
  在其他位置右键不追加。
- 新建：看板经 `create-companion` 操作（原生绑定、HTTP、iframe 桥三条路径一致，输入仅 `threadId`）调用 Router
  的调用方鉴权接口 `POST /v1/claude-companions/create`。Router 读取该会话本地 rollout 的最近记录，用一次无工具的
  Claude 调用建立真实会话（消耗 Claude 订阅额度，通常十几秒），成功后才保存绑定；已有伴生时原样返回。
  看板随后收编该记录、展开伴生行并打开终端，终端里 `claude --resume` 接上这份上下文。
- 该 Codex 会话之后改用 Claude 模型时，Router 首轮会导入同一个伴生会话，不另起新会话。
- 失败如实提示（无本地记录 404、Claude 未完成 502、Router 不可用 503），不保存半成品。凭证只在看板进程内读取，
  不进入渲染进程、URL 日志或错误信息。创建请求允许 6 分钟，其他终端操作仍是 30 秒。
