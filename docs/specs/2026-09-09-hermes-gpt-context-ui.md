# Hermes GPT 工作上下文面板

## 用户行为
在 Hermes 聊天页顶部提供“GPT 工作上下文”入口。展开后列出本机 GPT 项目，选择项目查看会话；支持按原始标题搜索，选择会话预览近期公开消息，按需读取更早消息。“带入当前聊天”将当前预览作为带来源标识的历史材料插入现有草稿，不发送、不清空原草稿。不可用时明确提示。

## 边界与实现
复用只读 GptContextService，插件 API 挂载在 Hermes 已认证的同源 API 下，不新增监听端口。固定只读查询进程只接受三个白名单方法，输入输出、时长有界。项目会话归属、消息过滤、游标、远端排除沿用既有契约。前端使用 Hermes 插件 SDK 和 chat:top 槽位，不持久化会话正文。
Hermes 宿主增加通用 appendChatDraft SDK：仅当前可见且连接就绪、启用 bracketed paste 的聊天页允许插入；控制字符过滤，不附加提交按键，失联或隐藏时拒绝。插件通过此接口操作，不直接接触终端 DOM 或令牌。

## 验收
测试固定方法分发、错误处理、草稿接口的可用性和控制字符处理；运行两个仓库适用检查。部署插件并在 Personal Panel 内实际验证项目列表、标题搜索、消息预览、草稿插入及原草稿保留；不发送验证内容。保留用户配置与其他未提交改动。

## 已完成验证
2026-09-09：插件安装进真实 Hermes dashboard，并在 Personal Panel 内完成项目选择、标题搜索、公开消息预览和保留既有草稿的带入验证。控制台 562 项、Hermes web 200 项测试通过，构建通过。详细记录见 `docs/hermes-gpt-context-ui.md`。

## 修订：迁入 Hermes Desktop
用户明确指定 Hermes Desktop 正式聊天界面，并要求撤下 Dashboard Chat 中的旧面板。UI 改为独立桌面插件，通过原生 `composer.attachments` 的“GPT 工作上下文”菜单打开 Dialog。原生 `insertText` 保留当前草稿且不提交，写入前核对会话和配置档案。只读后端保持不变，Dashboard 插件只挂载 API，不注册 UI 槽位。独立 Hermes 与 Personal Panel 使用同一插件，详细说明以 `docs/hermes-gpt-context-ui.md` 为准。

## Shared-history replacement

The user clarified that both surfaces must continue the same history. The attachment-picker migration is superseded by `2026-09-09-hermes-shared-conversations.md`. The desktop plugin no longer registers a popup or attachment action. The native connection adapter supplies first-class project/session projections, retaining original GPT execution ownership.
