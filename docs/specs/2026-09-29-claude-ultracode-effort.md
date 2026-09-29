# Claude 推理强度：Ultracode

## 目标

Claude 设置面板的推理强度增加 `Ultracode（多智能体）`。选中后，路由以
`claude --effort ultracode` 启动伴生 Claude：CLI 2.1.284 将其解析为 xhigh
推理并开启 ultracode（该轮可使用 Workflow 多智能体编排）。

## 契约

- Codex 推理强度枚举没有 `ultracode`，控制台把它写成 Codex 最高档 `ultra`；
  路由仅对 Claude 订阅模型把 `ultra` 映射为 `ultracode`，其他档位原样传递。
- 路由 Claude 目录增加 `ultra` 档位；旧版 Codex（无 ultra 枚举）照常被目录钳制。
- 面板本地记录保存 `ultracode`，切回 GPT 时恢复原模型与强度。仅自动强度模型不可选。
- 账号不支持 ultracode 时由 Claude CLI 自行降级处理；控制台不伪造状态。

## 验收

- 选择与恢复、持久化、Codex 档位映射、CLI 参数、目录档位均有回归测试。
- 生效需要重启路由（目录与映射）并重载控制台注入；未重启前不宣称已生效。
