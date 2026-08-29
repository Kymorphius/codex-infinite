# Codex Control Console

这是一个嵌入 OpenAI Codex 桌面应用的本机包装版控制台。包装版保留 Codex 原生的常规聊天方式，并为包装版中的所有原生对话统一请求扩展上下文；本机普通 Codex 的配置不受影响。它还通过已验证的 loopback CDP 连接注入本地 dashboard，提供“控制台”、“看板”、“会话中心”、“项目优先级”、“上下文状态”和“文献库”等辅助工作区。

本项目按长期产品维护。功能开发采用 [SDD 流程](docs/development.md)，模块边界见 [架构说明](docs/architecture.md)，产品规格与架构决策分别保存在 `docs/specs/` 和 `docs/adr/`。`npm run check` 会执行语法检查和结构预算，阻止巨型文件继续增长。

## 多设备会话中心

“会话中心”采用“设备 → 工作目录 → 原生会话”三层结构。当前版本把本机共享 `CODEX_HOME` 作为第一个只读数据源：同名但路径不同的目录不会被错误合并，点击会话会返回 Codex 原生聊天，不会复制会话或建立第二套聊天系统。

设备身份已经进入会话数据模型，因此后续可以把远程 Linux 上的 CodeKanban 或轻量代理接成新的设备数据源。远程节点只需返回标准化的设备信息与会话摘要；本地界面、目录分组和原生聊天仍保持不变。远程传输与认证暂未启用，在明确配置设备地址和凭据前不会开放网络监听。

## 常规聊天扩展上下文

包装版启动时会准备独立的 `~/.codex-control-console/config.toml`，其中写入：

```toml
model_context_window = 1000000
model_auto_compact_token_limit = 1000000
```

包装版的 Codex 进程使用该独立配置目录，但会通过符号链接复用普通 Codex 的登录状态、会话记录、模型目录、skills 和 plugins。因此目标对话仍会出现在原生侧栏中，使用方式也是正常对话：直接新建或打开对话，在原生输入框发送消息即可，不需要先加入看板。

`~/.codex/config.toml` 不会被修改。请求值也不等于模型保证提供的实际窗口：当前本机 `gpt-5.6-sol` 模型元数据将 1,000,000 的请求钳制到 872,000 tokens，按 95% 有效比例预计可使用 828,400 tokens。包装版同时提高自动压缩阈值，以免仍按默认窗口过早压缩；到达模型实际容量后，Codex 自身的上下文接续机制仍会生效。

## 启动

```bash
npm start
```

启动器会：

1. 从普通 Codex 配置生成包装版专用 `~/.codex-control-console/config.toml`，加入扩展上下文和自动压缩阈值。
2. 确保 dashboard 只监听 `http://127.0.0.1:47831`。
3. 启动只使用 `127.0.0.1:9231` 的专用 Codex 实例，并把 `CODEX_HOME` 指向包装版目录。
4. 使用 `/Users/matrix/Library/Application Support/Codex Control Console` 作为专用 Chromium profile。
5. 把 dashboard 注入到专用实例，并在 renderer reload 后重新注入。

如果 `9231` 已经被另一个 profile 占用，启动器会拒绝附着或终止它，避免误触碰正常 Codex 实例。

首次启用全局扩展上下文，或修改 `CODEX_CONTROL_CONTEXT_WINDOW` 后，必须先完全退出已经打开的包装版窗口，再运行 `npm start`。启动器会拒绝附着到仍使用旧环境的包装版进程，避免界面看似正常、实际却没有启用扩展上下文。

默认请求 1,000,000 tokens。如需改变包装版的统一请求值，可在启动时设置 `CODEX_CONTROL_CONTEXT_WINDOW`；该设置只属于包装版。

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

“上下文状态”中的单会话表单是看板调度器的可选覆盖功能。覆盖保存在 `src/.runtime/context-windows.json`，只在看板通过 `codex exec resume` 续接命中的会话时追加 `-c model_context_window=<tokens>`。它不是原生聊天的入口；包装版原生聊天已经由包装版专用配置全局启用，无需目标对话先出现在看板中。页面同时显示请求值、模型目录允许的最大接受值、按模型有效比例计算的预计可用值，以及会话记录中最近观测到的实际窗口。

例如，会话 `01a015ac-363f-7472-961a-f31d174ad2c8` 仍保留看板调度请求 `1,000,000` tokens；即使不使用该调度覆盖，只要在包装版中以原生方式打开它，包装版的全局扩展上下文也会生效。

调度状态保存在 `src/.runtime/dispatch-board.json`，会话上下文覆盖保存在 `src/.runtime/context-windows.json`；文件权限均为当前用户读写，并已加入 `.gitignore`。服务重启时，未完成的“发送中”任务会回到队列；发送失败会保留错误信息，用户可手动重试。所有写接口仍只监听 `127.0.0.1`，并拒绝来自其他浏览器 Origin 的写请求。

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

专用 Codex 实例左侧原生“项目”列表也会使用同一顺序。注入层每 15 秒从本机只读 API 接收一次项目排名，在 React 重绘后重新应用；无法匹配到任务元数据的原生项目保持原有相对顺序并排在已排名项目之后。这个调整只存在于专用 renderer 的 DOM 中，不写入 Codex 配置或应用文件。

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
- 只对专用 CDP renderer 设置 `Page.setBypassCSP`，让本机 dashboard 能在 Codex 的受限 `app://` workspace 中显示；不写入应用包。
- 不会终止正常 `/Users/matrix/Library/Application Support/Codex` 对应的进程。
- 注入使用 DOM marker、new-document script 和定期同步，入口可重复执行且不会重复添加。

## 文件范围

实现只位于 `package.json`、`README.md`、`src/`、`public/`、`scripts/`、`test/` 和 `.gitignore`。该目录初始为非 Git 项目；本 MVP 不初始化 Git、不提交、不推送、不创建 PR。
