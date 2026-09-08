# Windows dedicated sidebar recovery

## Scope and evidence

The user requested the existing Windows Control Console sidebar to have the
same section labels as the macOS dedicated window and to follow project weights.
Both installations have identical sidebar injection source. Live Windows
headless checks found 78 thread markers with 78 project/device label hosts,
but only Pinned, Projects, and Recents sections. Its native section registry
contained only Pinned; its per-account custom-section state was empty.

Windows native thread paths use an extended-length prefix. Before the matching
repair, zero of 160 recent threads matched project roots; removing that prefix
made 153 match. The project-order spec covers the permanent path normalization.

## Recovery contract

- Apply the existing weight formula through native `project/move`; keep unknown
  projects in their prior relative order and leave cloud projects untouched.
- Reuse native sections by exact name or create them with `threadSection/create`.
  The reference names are 现在, 等待, 本周, 协同, 项目（聊天）, 云工作, 临时, 待整理.
- Bind those locally generated section identities to the dedicated wrapper's
  existing account state. Preserve unrelated state, existing memberships and
  sections. Newly created sections start empty. Copy no foreign thread/project
  identifiers or account credentials.
- Back up the wrapper state before writing its section presentation/order while
  the dedicated process is stopped. Leave the ordinary desktop process running.
- This is a bounded repair of this installation, not automatic cross-device
  section federation. Do not mutate SQLite directly or change loopback boundaries.

## Verification

- Run source/structure checks and tests; record any Windows suite limitations.
- Verify matching and priority regression tests on both operating systems.
- Read native project positions back and compare against the calculated order.
- Read native section identities and test the live dedicated document's section
  headings, thread label hosts and generated label styles after restarting it.
- Confirm the ordinary desktop process and user data remain intact.

## Recovery evidence

- macOS syntax/structure checks passed; 363 tests passed. Windows syntax and
  structure checks passed; all 6 project-order regressions passed there.
- The deployed Windows suite reported 331/338 passing, with 7 failures outside
  project-order (launcher, Windows config, sidebar registry, copy receipts,
  copy selection, static index assembly, and moved-thread display). This repair
  does not claim that the full Windows suite is green.
- Startup applied 47 native project moves. A fresh calculation from 160 local
  sessions subsequently matched all 47 persisted native positions.
- Leading scores at verification: 自动查询晚归人员并报送 96, 交换机控制 93,
  WorldManager 83, 大数据自动签到报平安 83, 真仙幸存者 76.
- All 8 reference custom section names exist as Windows native identities and
  are present in the dedicated document. The existing section-layout injector
  applies the same configured visual ranking as on macOS.
- After restart, all 72 mounted native thread markers had generated label hosts
  and label injection version `2026-09-04.1`. These are live headless document
  checks, not a manual screenshot/interaction review.
- The wrapper state backup is `.codex-global-state.json.before-sidebar-recovery-20260905`
  in the Windows wrapper home. No foreign conversation memberships were copied.
