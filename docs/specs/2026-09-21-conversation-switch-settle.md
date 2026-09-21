# Conversation switch settling

## Problem

Live switching between already-open local conversations reaches the route in
roughly 284–460 ms and renders initial content in roughly 424–877 ms, but the
page continues mutating after content appears. Profiling identifies repeated
same-value writes from held-message controls and turn annotations. These writes
do not change what the user sees, but they keep native observers and layout
work active during the switch settling period.

## Behavior

- Keep held messages, save-as-todo, task claiming, turn annotations, previews,
  and navigation fully enabled.
- Skip DOM property, attribute, text, class, and inline-style assignments when
  the rendered value is already correct.
- Reinstall save-as-todo controls only when their mounted controls disappear;
  ordinary conversation mutations must not schedule reinstall work.
- When the native output card is absent, scan for it at most once per second.
  A conversation change resets this throttle so a newly mounted card is found
  immediately.
- No storage, queue, routing, or message-send contract changes.

## Acceptance

- Held queue shell and claim button helpers perform zero writes for an
  identical second update.
- Draft button state performs only changed writes.
- Save-as-todo observation ignores unrelated mutations while controls remain
  mounted.
- Annotation status, visibility, class, and geometry updates are idempotent.
- Checks and the complete test suite pass, followed by live switch readback.
