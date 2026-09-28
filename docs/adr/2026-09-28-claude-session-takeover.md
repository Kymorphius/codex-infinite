# Claude 会话强制接管可结束其他 Claude 进程

- Status: accepted
- Date: 2026-09-28
- Deciders: 项目维护者
- Related specs: docs/specs/2026-09-26-managed-terminal-conversations.md

## Context

看板托管的 Claude 会话可能同时被别处的 Claude 进程占用（终端窗口、Claude 后台会话宿主）。两个进程写同一会话会让记录分叉，所以看板默认只读并拒绝启动。用户需要像原生会话那样，在看板里明确地把会话接管回来。这是控制台第一次向不由自己创建的进程发送信号。

## Decision

仅在用户两次点击确认后，`start` 携带字面布尔 `takeover: true` 时执行接管。服务重新读取 `~/.claude/sessions/<pid>.json` 登记，只向同时满足以下条件的进程发信号：登记的会话 ID 在该会话的 continued-in 链上、进程存活、属于当前用户、命令名为 `claude` 或 `claude.exe`。每次发信号前重新核对命令名以防 PID 复用；任一占用者无法核实则一个信号都不发。由 Claude 后台守护进程托管的会话（登记 `kind: "bg"` 且带 8 位十六进制 `jobId`）通过 `claude stop <jobId>` 停止，不发信号，守护进程据此记为停止而非崩溃；停止失败则整体放弃。交互式占用者先 SIGTERM，5 秒后仍存活才 SIGKILL；仍有占用者时返回 409，不启动。

## Alternatives considered

- 只提示用户去别处退出：安全但无法满足在看板里接管的需求，且后台宿主中的会话没有可见窗口可退出。
- 直接 SIGKILL：可能中断正在写入的记录，放弃。
- 对后台会话也发 SIGTERM：首次实测中守护进程将其显示为崩溃，用户在原窗口继续后又被重新拉起，与看板形成两个写入者，放弃。
- 结束父进程（如 `claude bg-pty-host`）：影响范围超出该会话，放弃。

## Consequences

接管会结束另一处的 Claude 会话，其中未发送的输入会丢失，因此需要两步确认。验证依赖 Claude 的会话登记格式和进程命令名；若 Claude 改变这些，核实会失败并拒绝接管，而不是误杀。Windows 暂不涉及。

## Supersedes / superseded by

None.
