# Claude Router 预览入口

## 范围

仅增强版 native composer 增加独立 Claude 预览入口，不改变普通客户端、不使用托管终端，也不默认迁移任何会话。
Router 模型已改名为 `claude-subscription/opus`，支持 low/medium/high/xhigh/max；旧 ID 仍被接受（见 2026-09-28-claude-companion-sidebar）。
面板明确 Computer Use 范围和短会话限制，不把未实现模型列为可用。

## 契约

- 使用现有原生 thread/settings/update 和 thread/resume 回读；不把本地 Router 凭证传入 renderer。
- 仅已有本机会话可选择；新建未获得 ID、远程会话、当前正在生成时不修改设置。
- 开启前记录原模型/强度；设置成功且回读一致才报告启用。关闭恢复原模型/强度。
- per-thread 选择存储不含消息/凭证，最多 128 条；失败不能宣称成功，回读不一致时尝试回滚。
- 选择和设置期间，该会话 Jev/Turbo 不覆盖手动 Claude 选择；其他会话不受影响。
- UI 更新使用既有 mutation subscriber 和有限 debounce，不增加定时轮询。

## 验收

已验证：语法与结构检查通过；Claude 选择及原生设置/Jev/Turbo 专项 33 项通过。仅允许明确的 Claude 预览模型例外，不放开任意带斜线模型。
已按用户授权重载增强版控制服务，运行状态接口恢复正常；用户随后也手动重启。
尚未完成：全量测试已启动且输出到第 924 项无失败，但会话中断后未取得最终汇总，不算全量通过。
可见界面和实际模型设置回读仍待验收：Computer Use 明确拒绝操作 com.openai.codex，未绕过限制。增强版 launcher 的控制台可读，不等于原生对话按钮已验证。
启用时要求 Router 通道可用；原生直连模式不修改为 Claude 模型。此检查不是后台预览能力的实时探测。
真实发送可能消费订阅，UI 可见和设置回读不等于真实 Computer Use 验收。

## 按钮缺失修复

- 首次安装不得依赖 Jev 事先创建 mutation subscriber；主动创建订阅集合，后续安装请求补绘。
- 专用窗口在 Jev 安装后加载 Claude；原生增强窗口的现有注入清单也加载同一入口，包含文档重新加载路径。
- 11 项专项通过，包括输入框晚出现后挂载、重复安装不重复添加和原生窗口注入清单。
- 后台已重载且运行状态接口恢复正常；未自动切换模型或发送消息。可见按钮仍需用户回读，工具不允许检查原生应用。
- 本轮全量测试已运行，发现并发改动范围内的 native-conversation-tabs 版本字符串断言失败；未改动该文件，不能宣称全量通过。
