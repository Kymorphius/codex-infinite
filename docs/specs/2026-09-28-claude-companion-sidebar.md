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

## 顺带修正

Claude 预览按钮改用 Router 的新模型 ID `claude-subscription/opus`，强度增加 xhigh 与 max；旧 ID 仍被接受，
已保存的旧选择可以恢复。

## 验收

- 适配器、合同、收编、占用区分（sdk-cli 不可接管）与侧边栏放置均有专项测试。
- `npm run check` 与 `npm test` 通过；并发改动造成的无关失败需单独说明，不能宣称全量通过。
- 实际界面由用户在增强版窗口中回读确认；本变更不自动切换模型、不发送消息、不结束任何 Claude 进程。
