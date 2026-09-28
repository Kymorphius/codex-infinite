# Windows 专用外壳调试端口恢复

- Date: 2026-09-28
- Status: Windows port recovery deployed; native page acceptance pending

## 现象与边界

Windows 控制台 HTTP `127.0.0.1:47831` 正常返回页面，但原生页面持续显示加载中。修复遗漏的 `prompt.js` 静态路由后，浏览器资源已返回 200，注入器仍持续报 `127.0.0.1:9231` 的 CDP 超时。专用外壳重启后，旧 IPv6 监听仍占用 `::1:9231` 且无法响应；普通 ChatGPT 窗口和设备身份必须保留。

## 方案

Windows 节点运行配置可选 `cdpPort`，默认 `9231`。启动脚本将它传给 `CODEX_CONTROL_CDP_PORT`，安装脚本写入默认值。仅对异常 Windows 节点指定新的空闲端口；由于 Chromium 在该设备使用 IPv6 回环监听，新增同端口的 `127.0.0.1 → ::1` 本机转发。保留原 `9231` 规则与配置备份，确认新端口正常后只重载专用控制台服务和外壳。

## 验证

- 启动脚本读取可选端口并保留默认值；配置仍受 `src/loopback.mjs` 的回环约束。
- 新端口的 Windows CDP `/json/list` 实际可读；控制台静态依赖与原生页面初始化完成。
- 普通 ChatGPT 进程、设备身份、凭据和运行数据不变；没有运行中的控制台终端时才重载。

## 本次读回

- Windows 独立备份：`C:\Users\Admin\.codex-control-console\deploy-backups\cdp-port-recovery-01a0e884`，包含原启动脚本、节点配置和旧端口转发清单。
- 仅更新 Windows 专用节点的 `cdpPort` 为 `9241`，新增 `127.0.0.1:9241 → [::1]:9241`；原 `9231` 规则未删除。服务重载后日志显示 `CDP launched on http://127.0.0.1:9241`，本机 `/json/list` 返回 200 且可列出 `app://-/index.html`。
- 原生页面的最终视觉状态仍待现场确认，不能把调试端口 200 当作页面验收。
- `npm run check` 通过；完整 `npm test` 本次为 1487/1488，失败在其他会话正修改的 `test/claude-preview-selection.test.mjs`，断言得到 `GPT` 而非 `Claude 预览`。本次端口相关的 3 项测试通过。
