# Personal Panel 原生任务跨应用边界

## 决定

控制台综合清单、发送调度和 Personal Panel／Anytype 原生任务保留各自权威。任务看板是多来源投影，不通过标题匹配创建“统一任务”副本。Personal Panel 的对象身份为账户、空间、对象 ID 的组合。

控制台只调用 Personal Panel 提供的受限单次 CLI（`task.list/get/update/complete`），不直接接触 Anytype 数据库或高权限维护 socket。写入必须持有读取时的 revision，源端负责再核对 owner、对象及原生字段并读回。超时和不确定写入不能自动重试。

## 理由与后果

两个系统的完成含义不同：Codex 任务的“已发送”不等于 Anytype 任务的“已完成”；同名也不能证明同一对象。保持边界可以先实现同屏查看与明确状态动线，而不破坏既有记录。以后若需跨来源关联，应增加用户确认的稳定 ID 关系和独立的冲突处理，不得凭文本静默合并。
