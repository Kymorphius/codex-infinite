# 全套看板同步验收

- Date: 2026-09-28
- Status: files deployed and services reloaded; native task-data UI acceptance incomplete
- Release: `711c57e9b99fe8a129a285323ec6860d6b9eb584`

用户要求把最新看板全套同步至 Pro 和 Windows。从最新已提交版本生成独立完整快照；共享工作区其他会话正在修改的未提交终端功能未纳入发布。发布不覆盖设备身份、登录、凭据、任务数据库、配置或依赖运行目录；依赖清单与目标一致，无需替换各平台 node_modules。

## 验证和部署

- 独立发布快照 `npm run check` 通过：723 个语法检查文件、763 个结构检查文件；`npm test` 1476/1476、零失败和跳过。
- 两台各检查 1005 个版本文件，更新 177 个，最终全清单 SHA 一致；各执行 726 个脚本语法检查通过。既有差异的运行代码均能对应本仓库历史版本，未发现需要覆盖的目标独立代码修改。
- Pro 备份：`~/.codex-control-console/full-dashboard-deploy-backups/e65770d6-bf49-41db-af49-d55b38057776`。
- Windows 备份：`~/.codex-control-console/full-dashboard-deploy-backups/577bec91-148b-48c4-86e9-49ef112473d8`。
- 每份备份包含被替换文件和 restore-manifest.json。写入前比对旧 SHA，原子替换后再次比对，失败仅恢复本次仍未被他人修改的文件。
- 两台确认无运行中的控制台终端后重载；Pro 服务 PID 12540 → 12694，Windows 28892 → 24756。原生应用进程保持；项目同步页面四项资源 HTTP 和内容 SHA 均正确。
- Air 按用户要求不重载，保留新启动的两个 Claude 终端；磁盘中的最终 Windows 通道补丁尚未在 Air 主服务加载。

## 验收边界

经临时 SSH 只读页面查看，两台均显示完整看板框架和功能入口；任务数据仍显示读取中，不能据此宣称原生桌面所有交互已验收。Pro 签名项目目录读取 15 个成功；Windows 全量重载后目录读取返回“原生分区当前不可读取，请显示该设备分区后重试”。此前仅项目同步增量发布时 Windows 44 个目录读取成功。Pro → Windows 项目同步通道也仍报告不可用；本轮部署完成不等于该方向的运行连接已修复。

共享身份、解除/重新关联与双向代码同步的隔离实机验收另见 [项目身份与副本关联](2026-09-28-project-sync-identity.md)。新副本创建、未提交迁移、会话与任务 owner 交接仍按独立阶段推进。


## 连接修复复查（同日）

- Windows 原生分区读取错误未持续复现：重新通过节点签名接口读取成功，44 个项目均声明身份关联能力。服务日志确认 CDP 已连接；现有证据支持该错误是重载后的暂时不可读，不据此改动原生权限或索引。
- Pro 的 Windows 配置仅含旧局域网直连与中继；旧局域网地址连接超时，未配置本机已验证可用的 Tailscale 通道。Pro 对该远程地址也没有 SSH 主机身份记录，严格校验正确拒绝连接。
- 经 Air 已信任的 Windows SSH 连接读取 Windows ED25519 公钥，再从 Pro 探测目标并比较公钥一致；仅补充该地址的 known_hosts 条目及 Windows peer 的一条直连路由，保留原路由、签名密钥及其他节点配置。未使用宽松主机校验或复制设备身份。
- 原 Pro peers.json 和 known_hosts 保存在 `~/.codex-control-console/connection-repair-backups/e295b672-eac9-4bb2-8a90-efe49a92b6d9/`。新建连接通过严格 SSH 校验后，Pro 的实际签名项目接口已读取 Windows 44 个项目。
- 确认 Pro 无活动控制台终端后重载，原生应用进程保留；Air 按用户要求未重载，已有终端保持运行。本轮未修改产品代码，改动为设备本地连接配置及本验收记录。
- Pro 正式协调接口及实际项目同步页面均读回 3/3 设备可用：Pro 15、Air 38、Windows 44。验收后关闭临时页面与 SSH 转发。部署快照重新执行 check 和 1476 项测试全部通过；共享工作区其他会话修改未包含在该测试结论中。
