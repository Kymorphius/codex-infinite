# Codex Infinite

> 给 Codex Desktop 加上一层跨设备、可调度、可观测、可扩展的控制平面。

Codex Infinite 是一个面向重度 Codex 用户的桌面增强层。它保留原生 Codex 的聊天、项目和会话体验，不替换应用、不修改应用包；同时通过经过约束的本机桥接，把原生客户端扩展成能够管理多设备、多项目和长时间任务的统一工作台。

## 我们增强了什么

| 增强能力 | 带来的变化 |
| --- | --- |
| **跨设备完整节点** | macOS 与 Windows 都可以作为会话所有者运行；在一个会话中心查看不同设备、工作目录和原生会话。 |
| **远程会话控制** | 从当前设备读取远端会话的完整执行记录，发送新消息、继续对话、处理审批并调整线程设置；动作始终路由回真正拥有该会话的桌面。 |
| **按会话扩展上下文** | 为指定会话单独请求最高 1,000,000 tokens 的上下文，并展示模型接受值、预计有效值和原生引擎实际回报值，不污染全局配置。 |
| **Turbo 模式** | 为需要更高吞吐的任务提供显式、可见、可回退的全局加速入口，同时保留默认模式和安全边界。 |
| **任务看板与可靠调度** | 把任务放入待排期、定时或立即发送队列；单并发交付、尝试编号、脱敏审计和“交付结果未知”状态避免重启后误重发。 |
| **原生会话工作区** | 顶部标签、多会话切换、需关注会话聚合、项目搜索、新建项目、复制路径和跨设备项目复制，让大量项目与对话仍然可管理。 |
| **跨设备 Skill 共享** | 查看、同步和管理各节点的 Codex Skills，让常用能力不再困在某一台机器。 |
| **项目优先级** | 根据近期活动、活跃会话和运行跨度计算透明的 0–100 优先级，帮助决定下一步该关注什么。 |
| **Zotero 文献工作区** | 只读索引本机文献库，并通过独立、授权受控的 Local API 桥安全编辑条目、创建笔记和集合。 |
| **原生视觉与运行诊断** | 主题跟随、统一图标和自适应刷新保持原生观感；分层诊断明确区分 dashboard、桌面桥、调度器和状态存储是否就绪。 |

这些增强建立在明确的安全边界上：网络与 CDP 默认只监听 `127.0.0.1`，所有写操作检查精确 Origin，凭据与普通 Codex profile 隔离，节点只导出经过验证且有界的数据，Zotero 数据库始终以只读方式访问。

本项目按长期产品维护。功能开发采用 [SDD 流程](docs/development.md)，模块边界见 [架构说明](docs/architecture.md)，产品规格与架构决策分别保存在 `docs/specs/` 和 `docs/adr/`。`npm run check` 会执行语法检查和结构预算，阻止巨型文件继续增长。

## 多设备会话中心

“会话中心”采用“设备 → 工作目录 → 原生会话”三层结构。当前版本把本机共享 `CODEX_HOME` 作为第一个只读数据源：同名但路径不同的目录不会被错误合并，点击会话会返回 Codex 原生聊天，不会复制会话或建立第二套聊天系统。

设备和工作目录都可以独立折叠，界面会在当前窗口生命周期内保留选择，并提供全部展开/折叠。设备折叠后仍显示目录、会话、进行中数量和最近活动；搜索或状态筛选会临时展开全部匹配项，清除筛选后恢复原布局。

设备身份已经进入会话数据模型，并采用对等的完整节点架构：每台 Mac 都运行同一套包装版、控制台和原生 Codex，会话仍归创建它的节点所有。会话中心每 15 秒静默同步各节点最近 160 条规范化会话摘要；远程条目会明确标注所属设备，尚未启用跨节点动作时不会错误调用本机原生打开或调度能力。

节点传输可自适应。`~/.codex-control-console/peers.json` 为每个节点配置有序候选，优先使用直接 SSH；不可达时自动回退到认证中继。当前两台 Mac 的备用路径通过 `67.230.169.158:33699` 建立反向隧道，中继端口只绑定服务器 `127.0.0.1`，两台 Mac 的 dashboard 和 CDP 也继续只监听本机回环。中继只转发节点自己的有界快照，不成为会话所有者，也不会递归转发从其他节点学到的数据。

本机节点由 `~/Library/LaunchAgents/dev.codex-control-console.plist` 持续运行完整包装版，由 `dev.codex-control-relay.plist` 维护备用隧道。MacBook Pro（192.168.1.30）使用相同的两个用户服务，应用位于 `~/Applications/CodexControlConsole`，Node.js 用户运行时位于 `~/.local/node-v22.23.2-darwin-arm64`；不会替换系统 Node 或普通 ChatGPT/Codex profile。

## 按会话扩展上下文

包装版启动时会准备独立的 `~/.codex-control-console/config.toml`，但不会在根配置中写入 `model_context_window` 或 `model_auto_compact_token_limit`。因此新建和普通会话沿用当前模型默认值。

每条已保存的原生会话在输入框旁显示“百万上下文”开关。点击开启后，包装版会立即通过桌面应用自身的 app-server 连接在 `thread/resume` 中附加两个会话级配置，并在后台保存；再次点击会恢复模型默认模式。“上下文状态”页面保留集中查看和批量管理。从会话中心、原生侧边栏或看板后台续接同一会话时都会应用保存的选择。设置只作用于该会话，不会改变其他对话。

包装版的 Codex 进程使用该独立配置目录，但会通过符号链接复用普通 Codex 的登录状态、会话记录、模型目录、skills 和 plugins。因此目标对话仍会出现在原生侧栏中，使用方式也是正常对话：直接新建或打开对话，在原生输入框发送消息即可，不需要先加入看板。

`~/.codex/config.toml` 不会被修改。请求值也不等于模型保证提供的实际窗口：控制台会按本机模型目录展示模型接受值和预计有效值；原生引擎会在该会话下一次真实对话的 token-usage 事件中回报实际 `modelContextWindow`。包装版不会为了验证而向用户会话发送测试消息。

## 启动

```bash
npm start
```

### Windows 完整节点

Windows 节点使用已登录用户安装的统一 `OpenAI.Codex` ChatGPT 包，并在
`%LOCALAPPDATA%\Codex Control Console\Profile` 建立独立 Chromium profile；
普通 ChatGPT 的包内 profile 不会被复用或重置。首次安装需要从提升权限的
PowerShell 运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 `
  -NodeId windows-desktop `
  -NodeName "Windows Desktop" `
  -NodeLocation "Windows workstation"
```

安装器检查 Node.js 22+、Codex CLI、OpenSSH 与 `OpenAI.Codex` 包，准备包装版
`CODEX_HOME` 的 allowlist 链接，然后注册只在当前用户交互登录会话中运行的
`Codex Control Console` 计划任务。持久运行任务使用普通用户权限；提升权限
仅用于首次准备链接和注册任务。dashboard 与 CDP 仍只监听 `127.0.0.1`。

卸载常驻任务但保留应用、普通 ChatGPT 和全部用户数据：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -Uninstall
```

启动器会：

1. 从普通 Codex 配置生成包装版专用 `~/.codex-control-console/config.toml`，移除根级上下文覆盖，使普通聊天使用模型默认值。
2. 确保 dashboard 只监听 `http://127.0.0.1:47831`。
3. 启动只使用 `127.0.0.1:9231` 的专用 Codex 实例，并把 `CODEX_HOME` 指向包装版目录。
4. 使用 `/Users/matrix/Library/Application Support/Codex Control Console` 作为专用 Chromium profile。
5. 把 dashboard 注入到专用实例，并在 renderer reload 后重新注入。

如果 `9231` 已经被另一个 profile 占用，启动器会拒绝附着或终止它，避免误触碰正常 Codex 实例。

新版桌面运行时同时通过 Chromium Local Network Access 和原生 renderer 的 CSP 拦截 `app://-` 内嵌的 loopback 页面。专用包装版进程单独关闭 `LocalNetworkAccessChecks`；注入器只对专用主页面 target 启用 CDP CSP bypass，并在第一次启用时重载一次原生页面，让该设置从新文档开始生效。重载标记随 renderer 文档保存，后台服务自身重启不会再次打断界面。这些兼容设置不作用于普通 Codex、其他页面 target 或系统浏览器，也不修改应用包。dashboard/CDP 仍只监听 `127.0.0.1`，所有变更接口仍要求精确 dashboard Origin。决策与风险边界记录在 [ADR 0005](docs/adr/0005-disable-lna-in-dedicated-wrapper.md)。

首次从旧的全局模式升级到单会话模式，或修改 `CODEX_CONTROL_CONTEXT_WINDOW` 后，必须先完全退出已经打开的包装版窗口，再运行 `npm start`。启动器会拒绝附着到仍使用旧环境的包装版进程，避免界面状态与实际配置不一致。

单会话表单默认请求 1,000,000 tokens。如需改变包装版建议的扩展值，可在启动时设置 `CODEX_CONTROL_CONTEXT_WINDOW`；它不会自动应用到普通会话。

## 验证

```bash
npm test
npm run check
npm run inspect
npm run inspect -- --open-console --screenshot
npm run inspect -- --open-kanban --screenshot=/tmp/codex-control-console-kanban-sidebar.png
npm run inspect -- --open-sessions --screenshot=/tmp/codex-control-console-sessions.png
npm run inspect -- --open-priority --screenshot=/tmp/codex-control-console-priority.png
```

`inspect` 会输出可核对的 CDP target、dashboard health、四个原生辅助入口数量与可见性、工作区 iframe URL 和任务数量。使用 `--open-sessions` 时还会核对设备、工作目录、会话层级及原生打开操作。截图默认写入 `/tmp/codex-control-console-evidence.png`。文献库的真实数据和筛选交互可通过专用 dashboard iframe 的 CDP 检查验证。

“看板”是独立的任务调度模块；原有本机任务记录仍可在“控制台”中只读浏览，“项目优先级”继续负责项目排序。

“看板”现在同时提供本机任务调度能力：填写任务标题和完整说明，选择项目后可自动指派到该项目最近对话，也可明确选择另一条对话。任务可以先放入“待排期”、指定未来时间，或立即加入单并发发送队列；状态依次显示为“待排期 / 已排期 / 排队中 / 发送中 / 已发送 / 异常”。到期任务通过安装包内的 `codex exec resume` 续接目标对话，指令经标准输入传递，不拼接 shell 命令，也不使用跳过审批或沙箱的危险参数。

“上下文状态”中的单会话覆盖保存在 `src/.runtime/context-windows.json`。原生界面打开命中会话时通过桌面 app-server 应用；看板通过 `codex exec resume` 续接时追加相同配置。页面同时显示请求值、模型目录允许的最大接受值、按模型有效比例计算的预计可用值，以及会话记录中最近观测到的实际窗口。

例如，会话 `01a015ac-363f-7472-961a-f31d174ad2c8` 保存 `1,000,000` tokens 后，无论从会话中心进入、从原生侧栏打开，还是由看板后台续接，都只为这一条会话请求扩展窗口。

调度状态保存在 `src/.runtime/dispatch-board.json`，脱敏的调度尝试审计记录追加到 `src/.runtime/dispatch-audit.jsonl`，会话上下文覆盖保存在 `src/.runtime/context-windows.json`；文件权限均为当前用户读写，并已加入 `.gitignore`。服务重启时，未完成的“发送中”任务会标记为“交付结果未知”而不会自动重发；用户核对目标对话后可以明确重试，每次实际领取都会产生新的尝试编号，旧尝试结果不会被覆盖。发送失败会保留错误信息，用户可手动重试。所有写接口仍只监听 `127.0.0.1`，并拒绝来自其他浏览器 Origin 的写请求。

`GET /api/diagnostics` 提供只读、无副作用的分层运行诊断，分别报告 dashboard、原生 Codex 桌面、调度状态存储、审计存储和调度器是否就绪。该接口不会发送测试消息，也不会为了诊断而恢复或修改任何会话。

侧栏中的“控制台”和“看板”是分开的入口：控制台展示平铺的当前任务列表；看板展示项目/状态四列。工作区内的模块切换也会同步切换这两个视图。

“项目优先级”也是独立侧栏入口。它按项目汇总会话并计算 0–100 的只读优先级分数：项目最近一次对话按 7 天窗口衰减，最多 70 分；近 7 天每个活跃会话增加 3 分，最多 15 分；会话从创建到最近更新的累计跨度（进行中的会话计算到当前时间）按对数增长，最多 15 分。这样最近对话决定主顺序，会话活跃数量和运行跨度用于辅助排序。页面会显示分数拆解、近 7 天活跃会话数和估算运行跨度，不会把记录跨度伪装成精确执行耗时。

“文献库”从本机 Zotero SQLite 数据库只读读取文献条目、集合、作者、日期、出版物、标签以及笔记/附件数量。默认数据库路径从当前用户 home 推导为 `~/Zotero/zotero.sqlite`，也可以用 `CODEX_CONTROL_ZOTERO_PATH`（或 `CODEX_CONTROL_ZOTERO_DB_PATH`）覆盖。读取连接使用 SQLite `readOnly` 打开，并启用连接级 `query_only` 防护；不会写入、迁移、vacuum、checkpoint 或修改 Zotero 数据库。界面只显示附件元数据和数量，不提供文件路径或附件内容服务。

文献库 API 为本机 loopback 只读接口：`GET /api/zotero/status` 返回连接和计数摘要，`GET /api/zotero/collections` 返回带层级深度的集合列表，`GET /api/zotero/items?q=&collection=&limit=&offset=` 返回有上限的分页文献摘要。条目列表默认排除笔记、附件和 PDF 标注等子条目；状态摘要仍保留全部 item row、笔记和附件计数，便于核对本地库规模。没有数据库时显示“未连接”，数据库可读但无文献时显示空状态，搜索无匹配时不会伪造结果。

### Zotero 10+ 回写桥接

“文献库”还提供一个与本地数据库分开的 Zotero Local API 回写桥。它默认访问 `http://127.0.0.1:23119/api/`，通过 `GET /api/` 发现 `Zotero-Server-ID` 和 API 版本，再把凭据严格绑定到该 Server ID。Local API 地址可用 `CODEX_CONTROL_ZOTERO_LOCAL_API_ORIGIN`（或 `CODEX_CONTROL_ZOTERO_API_ORIGIN`）覆盖，但仍必须是 `127.0.0.1`。官方协议说明见 [Zotero Local API](https://www.zotero.org/support/dev/web_api/v3/local_api) 与 [Zotero write requests](https://www.zotero.org/support/dev/web_api/v3/write_requests)。

用户点击“连接 Zotero 回写”后，Zotero 会显示自己的 Allow / Always Allow / Deny 授权提示；控制台不会替用户选择。选择 Always Allow 时返回的 key 只保存在专用 profile 目录中的 `zotero-local-api-keys.json`，文件由当前用户独占（0600）并使用原子替换，且按 Zotero Server ID 分区。选择 Allow 时 key 只在内存中保留，并在一次成功写入后失效。key 不进入浏览器 JSON、DOM、localStorage、URL、日志或错误信息；“忘记本地授权”只清除控制台保存的 key，不会清除 Zotero 的全局授权。

控制台公开的回写接口如下，全部只监听 loopback；每个变更请求都要求 `Origin` 精确等于 dashboard origin，JSON 请求有大小上限和字段白名单：

- `GET /api/zotero/write-status`：Local API 在线状态和回写授权状态，不返回 key。
- `POST /api/zotero/authorize`、`POST /api/zotero/forget-authorization`：请求授权或清除本地 key。
- `GET /api/zotero/edit/:key`、`PATCH /api/zotero/edit/:key`：读取当前版本并以 `If-Unmodified-Since-Version` 更新标题、摘要、日期、URL、DOI、ISBN、出版物等字段。
- `POST /api/zotero/items/:key/notes`：添加子笔记。
- `POST /api/zotero/items`：创建 `book`、`journalArticle` 或 `webpage` 顶层条目。
- `POST /api/zotero/collections`：创建集合，可选父集合 key。

作者、标签和集合成员关系只有在请求明确提交完整列表时才会替换；编辑前会重新读取条目并检查页面携带的版本。Local API 返回 412 时控制台显示冲突并要求重新加载，不会自动覆盖；401、403、409、428、429 分别显示需要授权、被拒绝/禁用、被锁定、缺少前置条件和提示节流。创建请求使用随机 `Zotero-Write-Token` 防止重复提交。此阶段没有任何删除接口，不提供附件或文件路径服务，也不直接写 SQLite。

如果状态显示“Zotero 未运行”，请先由用户启动 Zotero，再回到控制台点击连接；控制台不会在后台静默启动 Zotero。实现和自动化测试使用 mock Local API，不会修改真实 Zotero 数据库。

“项目优先级”的计算顺序只显示在控制台自己的只读模块中。注入层不再移动 React 管理的原生项目节点；GPT Work 工作区、Codex 项目的存在性、顺序和置顶状态完全由原生应用管理。

看板专用截图验证：

```bash
npm run inspect -- --open-console --exercise-filters --screenshot=/tmp/codex-control-console-kanban.png
```

## 数据边界

当前实现没有修改 Codex app-server，也没有修改 `ChatGPT.app`、`app.asar`、普通 Codex 的 Chromium profile 或 `~/.codex/config.toml`。包装版使用独立配置文件，同时以符号链接共享登录和会话数据。任务列表使用隔离的只读 adapter 扫描本机 Codex session JSONL 元数据：

- 只读取 session metadata、第一条用户消息、事件状态、工作目录和时间戳。
- 不复制 profile，不读取或输出 cookie、密码、token 或其他认证材料。
- 没有可读取任务时显示空状态；目录不可用时显示 disconnected；读取失败时显示 error，不伪造控制结果。
- 项目名从任务 `cwd` 的最后一级目录推导；缺少 `cwd` 时显示“未归类”。`active`、`completed`、`error/interrupted`、其他状态分别映射到“进行中”、“已完成”、“异常”、“待处理”。
- “在 Codex 中打开”使用会话 UUID 请求 Codex 原生 `/local/<conversationId>` 路由，因此目标会话无需预先出现在当前侧边栏。只有无法识别为本地 UUID 的旧数据才会回退到标题匹配；匹配不到时会如实显示不支持。

app-server/native route bridge 可用后，可以在 `src/task-adapter.mjs` 后方替换为正式 adapter；dashboard 与注入消息接口保持不变。

## 安全边界

- 所有 HTTP/CDP listener 都固定绑定到 `127.0.0.1`，配置会拒绝 wildcard、LAN 和 `localhost` 主机。
- CSP bypass 只施加到专用包装版的主页面 target；首次启用时重载一次使其生效，不写入应用包，不影响普通 Codex 或其他浏览器。
- 不会终止正常 `/Users/matrix/Library/Application Support/Codex` 对应的进程。
- 注入使用 DOM marker、new-document script 和定期同步，入口可重复执行且不会重复添加。

## 文件范围

实现只位于 `package.json`、`README.md`、`src/`、`public/`、`scripts/`、`test/` 和 `.gitignore`。该目录初始为非 Git 项目；本 MVP 不初始化 Git、不提交、不推送、不创建 PR。
