# Claude ⇄ GPT 讨论（配对 + 主持人 + 作战会议室）

- Status: in-progress
- Owner: Codex
- Date: 2026-09-29
- Related ADRs: none (an ADR is required before the phase-2 auto-relay ships, see Security)

## Problem

Claude CLI conversations and native GPT (Codex) conversations live side by side but cannot
see each other. To get a second opinion the user copies a reply from one into the other by
hand. The user wants the two models to discuss a topic with each other, to join in
themselves, and to watch the whole exchange in one place.

## Goals

- A **discussion** links exactly one Claude CLI conversation and one GPT conversation, in
  the same project, as participants.
- Three ways to drive it, on the same object:
  1. **Relay (配对)**: when one participant finishes a turn, its final answer is forwarded
     to the other as a message tagged with its source; repeat until stopped or the round
     limit is hit.
  2. **Host (主持人)**: the user posts a topic or a reply to the discussion; it is delivered
     to both participants, each answers, then each receives the other's answer plus any
     newer user message, for a fixed number of rounds.
  3. **Manual**: nothing is forwarded automatically; each answer shows a `转给对方` action.
- **Review gate (点评)**: a switch usable in any mode. After a participant answers, the
  discussion holds instead of forwarding. The user may add a comment (or skip it), then
  releases the hold. The other participant receives one message containing the answer and
  the user's comment, so it sees both the peer's view and the user's stance. If the user
  comments on the same answer twice before releasing, the comments are merged in order.
  Comments are also recorded in the room timeline and carried in later rounds as context
  (the next forward to either side includes the user comments made since its last message).
- Each participant conversation shows forwarded messages inline, marked `来自 Claude` /
  `来自 GPT` / `来自主持人`.
- A **作战会议室** view merges the timeline of both participants and the user, and holds
  the composer for the user's messages and the controls (start, pause, stop, mode, rounds).

## Starting a discussion from scratch (新建讨论)

On the native **新建聊天 page** (a composer with no conversation mounted) the `讨论` button is enabled and
its menu is just the two buttons: the composer's current text is the topic, the project is the one the
page is set to. On an existing conversation the same menu has a topic box instead. In both cases:

The `讨论` menu of an unpaired conversation starts with `新建讨论`: a topic box and two
buttons, `GPT 先答` and `Claude 先答`. Choosing one creates both conversations in the active
conversation's project, sends the topic, and pairs them.

- Project: the active conversation's project, like `新建`. It must have exactly one directory,
  because both new conversations must share it (a project with several directories is refused).
- The first responder gets the topic as typed. The other side cannot stay empty (a native GPT
  conversation does not exist until its first message is sent), so it gets a fixed opening
  message: the topic, who answers first, and "reply only 收到; answer when a forwarded
  message tagged 来自 … arrives". Until the first responder's answer is forwarded, that `收到` is the second side's latest answer (phase 1 does not filter it; the person simply forwards the first responder's answer; phase 2 must ignore it).
- GPT is created first (through the native new-chat page, exactly like a checklist claim: the
  composer must be empty), then Claude, then the pairing and the Claude message are done by the
  host. If GPT creation fails nothing is created. If a later step fails, the conversations that
  already exist stay and the toast says which step failed.
- On the new-chat page the topic is that composer's text: it is emptied for the native handoff and
  put back if the native send fails before anything was submitted. From an existing conversation the
  topic comes from a box in the menu, not the conversation's own composer draft (reading and clearing
  a Claude terminal composer inside a shadow DOM is fragile).
- After this the pair behaves like any other (phase 1: manual forward; phase 2: relay).
- The discussion records `first` and `topic` so later phases and the room view know who started.

## Non-goals

- More than two model participants, or other providers (ChatGPT web, shell, remote nodes).
- Models editing each other's files or running each other's tools; only message text moves.
- Replacing either conversation's own history. The discussion never writes native
  databases or transcripts.
- Free-running loops. Every automatic mode has a hard round limit.

## User experience

- Entry: a `讨论` button in the shortcut bar beside `新建`. On a Claude or GPT conversation
  it offers `与另一方配对…` (pick or create the counterpart in the same project) and, if one
  exists, `打开作战会议室`.
- Creating the counterpart reuses the `新建` routing (same project rules and refusals).
- Room view: header (two participant chips with live state idle/thinking/needs-attention,
  mode switch Relay/Host/Manual, round `n / max`, pause, stop), a merged timeline (colour
  and label per speaker, timestamps, forwarded-from links back to the source
  conversation), and a composer. The user's message goes to both participants in Host
  mode; in Relay mode the composer can target `Claude`, `GPT`, or `两者`.
- Review flow: with the gate on, each answer in the room and in its own conversation gets
  `点评并转发` (comment box, then send), `直接转发`, and `跳过`. While held, the state chip
  reads `等待你点评`. The comment is shown under the answer it refers to, and the
  forwarded envelope shows the answer first, then `[主持人点评]`.
- Round limit default 4, range 1–10. Reaching it pauses with a visible reason; the user
  can extend by choosing more rounds.
- States: a participant that is busy delays forwarding (queued, shown as `等待 Claude`);
  a participant that is closed, exited, or waiting on an approval pauses the discussion
  and names the reason; nothing is auto-approved.
- Stop is always available and immediately ends forwarding; already delivered messages stay.
- Keyboard: room composer follows the existing composer shortcuts. All controls have
  labels and Escape closes menus.

## Contracts and data

Persisted under wrapperCodexHome, next to terminal conversation records (bounded, atomic
writes, same store conventions):

```text
discussion {
  id, projectRef, mode: relay|host|manual, reviewGate: boolean,
  status: idle|running|paused|stopped,
  held: { sourceTurnId, from: claude|gpt } | null,   // answer awaiting comment/release
  participants: [{ role: claude|gpt, provider, conversationId }],   // exactly two
  round, maxRounds, pauseReason,
  cursors: { claude: <transcript offset/turn id>, gpt: <turn id> } // last forwarded turn
  messages: [{ id, at, from: claude|gpt|user, to: claude|gpt|both,
               text (≤ 12 000 chars, control chars stripped), comment?: string,
               sourceTurnId, delivery }]   // envelope text + comment together ≤ 12 000
}
```

- Messages in the room are copies for display; the source of truth for each answer stays
  in its own conversation. Duplicate forwarding is prevented by `sourceTurnId` + cursors.
- Forwarded text is wrapped in a fixed, plain-text envelope
  (`[来自 Claude · 讨论 <id> · 第 n 轮]\n…`) so the receiver and the user can tell it
  apart from the user's own typing.
- HTTP (exact-origin, loopback): `POST /api/discussions` (create/pair),
  `GET /api/discussions/:id` (state + timeline), `POST …/messages` (user message),
  `POST …/control` (start/pause/resume/stop/mode/rounds/forward-once). An event stream or
  short poll delivers timeline updates to the room view.
- Compatibility: additive. Conversations without a discussion are unchanged.

## Design and ownership

Dependency direction follows `docs/architecture.md`.

- `src/discussion-contract.mjs` — validation, envelope format, limits (pure).
- `src/discussion-policy.mjs` — pure state machine: given a turn-finished event, mode,
  round, and participant states, decide `forward | wait | pause | finish`. No I/O.
- `src/discussion-store.mjs` — bounded atomic persistence.
- `src/discussion-service.mjs` — application service; wires the policy to ports:
  - `answerSource` port: returns the final answer of a finished turn.
    Adapters: reuse `gpt-context-transcript.mjs` (GPT, read-only) and
    `terminal-conversation-transcript.mjs` (Claude, read-only). Turn completion comes from
    `conversation-activity.mjs` / the Claude transcript, never from screen scraping.
  - `messageSink` port: delivers text to a participant. Adapters: `RemoteMessageService` /
    `NativeConversationAdapter.sendMessage` (GPT, `queue` delivery when busy) and a new
    `TerminalService` bracketed-paste input method for the Claude PTY, gated on the
    conversation being ready and not in a permission prompt.
- `src/discussion-http.mjs` — exact-origin transport only.
- `src/native-discussion-button.mjs` — the shortcut-bar button and pairing menu
  (page module, same pattern as `native-new-conversation-button.mjs`).
- `src/native-discussion-room.mjs` (+ split style/timeline files as needed) — the room
  view. It consumes normalized timeline data only.
- `src/main.mjs` — wiring only. None of the above may be added to files listed in
  `config/structure-budget.json`; each stays inside the default budget.

## Security and privacy

- Loopback-only, exact-origin mutations, single controller per Claude terminal are kept.
- The relay moves message text only. It never reads credential stores and never approves
  anything: a pending approval or permission prompt pauses the discussion.
- **Prompt-injection boundary**: one model's output becomes another model's input. The
  envelope marks the source; the receiving side must not be given extra authority for it;
  round limits and per-message size caps bound loops and cost. Auto-forwarding mode
  is off until the user starts it, and every start is per-discussion, not global.
- Read-only session indexing is preserved: answers are read, never written back into
  native transcripts. Terminal input uses the existing PTY write path only.
- Because automatic model-to-model input relaxes the "manual input only" stance for
  terminal claims, phase 2 (auto relay/host) needs its own ADR and dedicated tests
  before shipping. Phase 1 (manual forward) does not.

## Rollout and rollback

Phased so each step is shippable and reversible:

1. **Phase 1 – contract, store, policy, manual forward with comment (点评并转发), pairing
   UI.** No automation; the review gate is the manual flow itself.
2. **Phase 2 – Relay and Host automation** with round limits, pause/stop (ADR first).
3. **Phase 3 – 作战会议室 view** with merged timeline and composer.

Rollback: stop all discussions, remove the button module from the injected sources;
discussion records are inert data and can be deleted without touching conversations.

## Acceptance criteria

- [ ] Pairing creates a record linking one Claude and one GPT conversation of the same
  project; a third participant, or a different-project pair, is rejected.
- [ ] Manual: `转给对方` delivers the latest final answer once, tagged with its source; a
  second click on the same turn does nothing.
- [ ] Relay: after a participant's turn finishes, the answer is forwarded exactly once,
  respecting busy state (queued, not dropped), until `maxRounds`, pause, or stop.
- [ ] Host: a user message reaches both; each answer is then cross-delivered together with
  any newer user message; rounds are counted per cross-delivery.
- [ ] Review gate: with it on, no answer is forwarded until released; a comment is
  delivered together with the answer in one message, once; skip forwards the answer alone;
  a held answer survives a console restart; stop discards the hold without forwarding.
- [ ] Comments made since a participant's last message are included in its next forward,
  and never delivered twice.
- [ ] A closed/exited participant or a pending approval pauses with a named reason and
  forwards nothing.
- [ ] Stop halts forwarding immediately, including a queued delivery.
- [ ] Restarting the console resumes with cursors intact and does not re-forward.
- [ ] Forwarded messages are visibly tagged in each participant conversation.
- [ ] The room view shows the merged timeline in order and the user's composer targets
  Claude / GPT / both.
- [ ] Non-loopback or wrong-origin requests are rejected; oversized or control-character
  text is sanitized or rejected.

## Verification plan

- Unit: policy state machine (all mode × state × event combinations), contract limits,
  envelope, cursor de-duplication, store atomicity.
- Integration: service with fake `answerSource`/`messageSink`, including busy, exit,
  approval-pause, restart-resume, and stop-during-queue.
- Real UI: pair a real Claude and GPT conversation, run 2 rounds in each mode, check tags
  and the room timeline (restart backend before judging injected visuals).
- Structure and regression: `npm run check` and `npm test`; no budget changes.

## Shipped deviations

Phase 1 backend (shipped in the working tree, UI pending):

- "Same project" is checked as equal working directory of the Claude conversation and the GPT
  conversation, not by project membership. Project membership lives in the page-side search
  catalog; the server only knows directories. Revisit if projects with several directories matter.
- Phase 1 has no `mode`/`maxRounds`/`held` behavior yet; the fields exist in the record
  (`manual`, 4, null) so phases 2–3 need no migration. `reviewGate` is implicit: nothing is ever
  forwarded without an explicit `forward` call.
- Standalone comments (`comment`) are kept in `pendingComments` and ride along with the next forward.
- HTTP is POST-only with the action in the path (`/api/discussions/<action>`), matching the
  terminal conversation API: list, get, for-conversation, create, latest, comment, forward, stop.
- Delivery to Claude waits for the conversation to be running and not busy; otherwise it is refused
  with 409 and can be retried (cursor and comments are untouched on refusal).
- Tests: `test/discussion-{policy,service,http,runtime}.test.mjs`, `test/claude-answer-source.test.mjs`.

Phase 1 UI (in the working tree; not yet exercised in the real desktop app):

- The `讨论` button (`src/native-discussion-button.mjs`) sits beside `新建`. Pairing lists
  same-directory conversations of the other kind (`candidates`, minus ones already paired).
  Forwarding is a panel in the button's menu (preview of the latest answer, comment box,
  `转发`), not a control on each answer inside the native conversation; per-answer controls
  belong with the room view in phase 3.
- Transport is a native page bridge (`src/native-discussion-binding.mjs`, registered through the
  injector's `extraBindings`), not HTTP. It calls the same validated operation table as HTTP
  (`src/discussion-actions.mjs`) and, like the terminal bridge, answers only the top frame of the
  `app://-` page. To know the calling context the injector now passes the CDP event params as a third
  argument to a binding's `handle` (a 21-byte change; `injector.mjs` stays within its budget).
- Candidate/title lookups add `candidates(cwd)` to each participant port.

新建讨论 (in the working tree; not yet exercised in the real desktop app):

- Page flow lives in `src/native-discussion-button.mjs` (`startNew`): `prepare` (host returns the two
  texts) → native new chat + composer handoff (`createNativeChecklistThreadStarter`, reused as is) →
  new Claude record via `__cccTerminalConversations.createRecord(..., { open: false })` (new; returns the
  record instead of only opening it) → `begin` (host pairs and delivers Claude's text). Claude first
  opens the new Claude tab at the end; GPT first stays on the new GPT conversation.
- `begin` waits for a not-yet-indexed GPT conversation (up to ~10 s) before pairing, and for the new
  Claude to report idle (up to ~20 s) before pasting. If Claude never becomes idle the pairing stays and
  the result carries `deliveryError`, which the page shows so the topic can be sent by hand.
- The discussion record now stores `first` and `topic` (both `null`/empty for pairings of existing
  conversations).

新建聊天 page (working tree; not yet exercised in the real app):

- Detected by DOM: a native composer, no `[data-above-composer-conversation-id]`, and an active tab that is
  not a terminal/console view. Project: the sidebar row with `aria-current="page"`, accepted only when its
  label equals the composer's project picker (`aria-label="更改项目：<name>"`), so a stale highlight or
  "不在项目中工作" is refused. The project is then found by id with the new search API `projectOfKey`.
- The new-chat page is already open, so the native "new chat" step is skipped; the rest of the flow is
  the same. Attachments in the composer are not carried (the native handoff is text only).

