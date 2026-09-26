# 全设备任务管理与跨设备分派

状态：实施中。覆盖已配置的可信 Codex 节点；设备接入仍沿用已有 peer 配置。

## 用户结果

- 看板提供全部设备的综合清单、项目清单和排期目录，支持搜索、设备筛选和分批展示。
- 可从任意已接入节点创建、编辑、完成、删除、退回、指派/重派清单任务。
- 跨设备指派保留任务来源、ID 和最初加入时间；目标会话显示暂停待办，用户点击入队才发送。
- 入队只记录已交付，不自动将任务标为完成。
- 离线来源保留最后成功快照，注明离线，禁用写入。来源不支持协议时单独显示，其他设备可继续使用。

## 数据与身份

清单权威仍为创建任务设备的 ProjectChecklistStore，不复制运行数据。统一身份为 `{ownerDeviceId, scopeId, id}`；scopeId 是服务器生成的清单文件摘要标识，不接收任意文件路径。存储可枚举现有综合与项目清单；历史项目没有名字时显示“项目任务”，不猜名称。

任务新增可选 `assignedDeviceId`、`executionState`、`deliveryReservation` 字段。旧 assignedThreadId 无设备值时等同 owner 本机。新指派使用完整 `{deviceId, threadId}`；指派前读取目标设备的会话目录核验身份。分派、退回不创建或发送消息。

已有会话入队和新建会话领取在发送前经源端 CAS 获取持久预占。只有持有预占凭证的客户端可确认交付；不以超时自动解除。确定未调用原生发送时允许凭证释放，未知发送结果显示“待核对”并禁止改派/删除。预占请求超时但尚未提交时可按原请求编号核对恢复，不得重复发送。

聚合快照含来源设备、连接状态、读取时间、任务版本。版本由完整原任务哈希生成，写入按 expectedRevision 比较并在源 store 串行锁内执行；冲突拒绝覆盖。requestId 回执支持同一请求重试，不同内容不能复用 ID。每份清单与最新回执原子提交；旧回执在下一次写入前先落盘至私有归档目录，避免历史回执挤满清单，同时保留幂等性。

图片随任务跨设备：源端将 IndexedDB 图片按任务引用读回至本机耐久缓存；指派前确认完整附件可导出。目标通过已签名的任务附件接口读取精确任务/版本的图片包，核验引用集合、MIME、大小、SHA256 后写入本机 IndexedDB。目标引用使用来源设备参与生成的确定 ID，避免跨设备引用碰撞；回写仍保留源引用。最多8张、每张8 MiB、合计24 MiB；不传任意路径。失败时保留原任务并禁用入队，显示图片尚未就绪。首版带图任务需指派到已有会话；新建会话领取带图任务在预占/发送前明确拒绝，不静默丢弃附件。

## HTTP 与传输

- `GET /api/node/task-center` 仅返回本节点原始目录，绝不再次聚合。
- `GET /api/task-center` 返回 `{version:1, localDeviceId, devices:[{device,status,updatedAt,items,message}]}`；每项为 `{key,ownerDeviceId,scopeId,id,source,text,done,assignedThreadId,assignedDeviceId,executionState,createdAt,updatedAt,revision,attachmentCount,input?}`。source 为 checklist 或 dispatch；dispatch 首版保留原生排期状态与详情。
- `POST /api/task-center/actions`：精确 Origin；输入 `{ownerDeviceId,scopeId,id,requestId,expectedRevision,type,...}`，type 为 create/edit/assign/return/complete/reopen/delete/verify-delivery/release-delivery/delivered，按所属节点路由。create 使用综合清单且仅保存。
- `POST /api/node/actions/task-center`：沿用 HMAC/nonce/replay 签名，绑定完整路径和请求体。操作回执返回真实结果。
- `POST /api/node/actions/task-images`：已签名只读附件导出，仅允许指定任务当前版本的图片集合；响应大小上限34 MiB，不缓存到任务变更回执。
- 委派只修改源任务，目标原生待办通过同一任务目录投影；不复制原任务，不由名称匹配会话。

原生综合清单同步使用聚合 facade：本机任务保持现有 ID，跨源任务使用可逆映射到稳定复合身份的投影 ID；远端任务操作带读取版本。只将分派给本节点的任务投影到本节点会话待办。来源丢失或冲突时拒绝写入，不把远端投影当作本机新任务保存。

## 性能与反馈

节点读取并行、请求合并、有限缓存与失败退避；初屏优先本机，远端到达后更新。后台刷新不覆盖编辑草稿，不重建未变化列表。默认展示有限条目，可继续加载。跨设备分派目标注明设备与会话，离线目标不可选。

## 验收

覆盖相同任务/会话 ID 跨设备不串写；文件枚举与路径限制；冲突及持久请求回执；离线快照；签名/Origin/篡改/重放；跨设备分派后目标本机待办存在且暂停；返回/编辑仍写来源；入队不等于完成；附件拒绝时原内容不变。

运行态在已接入设备逐台核对版本与端点。使用显式临时测试记录验证文本分派/退回/删除，不发送模型消息；清理仅针对本次创建的测试任务。既有 Turbo 并发改动与节点身份、凭证、运行状态保留。
