# GPT 工作上下文界面

入口：Personal Panel → Hermes → Chat → 顶部“GPT 工作上下文”。

左侧选择本机 GPT 项目，中间按原始会话标题浏览，右侧预览公开消息。搜索框查找当前项目的标题、项目名和目录；“全部会话”搜索所有项目。点击“带入当前聊天”把当前预览插入 Hermes 输入框，检查后自行发送。既有草稿会保留。更早消息通过预览底部按钮逐页读取；每次带入仅包含当前页，长消息可能截断。

范围沿用 [只读上下文服务](hermes-gpt-context.md)：本机原生 GPT/Codex 的持久化项目及会话，不包含其他机器或网页云端历史，不暴露私有推理、系统或工具记录。历史内容按纯文本显示，带入时附会话及消息标识，明确作为历史参考材料。

## 安装与宿主接口

插件源码位于 `plugins/hermes-gpt-context/dashboard/`，通过用户插件目录 `~/.hermes/plugins/gpt-context` 的符号链接安装，链接指向本仓库 `plugins/hermes-gpt-context`。需在 Hermes `config.yaml` 的 `plugins.enabled` 中加入 `gpt-context`，保留其他设置，并重启空闲的 Hermes dashboard。

前端使用宿主 `chat:top` 槽位及认证 `fetchJSON`。后端通过固定 Node 程序 `scripts/hermes-context-query.mjs` 读取既有数据服务；无新增网络监听。Node 优先使用 Hermes 安装目录内的运行时，再使用 PATH 中的 Node。后台只接收固定三个查询方法，20 秒超时，输入 64 KiB、结果 512 KiB 上限。

宿主 Hermes 需要本地新增的通用 SDK `appendChatDraft(text)`。该接口由 `web/src/plugins/chat-draft.ts` 实现，ChatPage 注册当前终端目标；只有可见、已连接、启用 bracketed paste 的聊天页可接收，拒绝空内容和超过 40000 字符的文本，过滤终端控制字符，不发送提交按键。插件不接触终端 DOM、认证令牌或模型执行接口。Hermes 更新如覆盖本地接口，按钮会提示更新界面。

## 2026-09-09 验证

- 控制台 `npm run check` 通过，`npm test` 562 项通过。
- Hermes web `npm run check` 通过：28 个测试文件、200 项测试；lint 为现有 26 个 warning、0 error。`npm run build` 通过。
- 实际插件 API 返回 37 个项目；未认证请求返回 401。
- Personal Panel 内实际选择“看板”（41 个活动会话）、搜索“评估 Hermes”返回目标会话、预览 12 条公开消息。
- 先放入带唯一标记的临时草稿，再点“带入当前聊天”；终端显示原标记及历史材料粘贴块，保持 ready，未提交消息。使用原生清空草稿快捷键移除本次验证内容，输入框恢复空白。
- 插件配置前有本机私有备份，其他配置值经比较保持一致。未重启原生 GPT 所有者进程。
