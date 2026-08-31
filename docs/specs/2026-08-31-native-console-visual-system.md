# Native console visual system

## Status

Implemented and deployed to MatrixBook Air and MacBook Pro on 2026-08-31.

## Problem

The unified conversation reader now matches the native Codex desktop chat, but
the surrounding control-console modules still use the older dashboard visual
system. In dark mode the module shell renders on `#1f1f20`, uses browser-default
font smoothing and line height, oversized 29 px introduction headings, and a
separate card hierarchy. Moving between a conversation and the session list,
board, context controls, project priority, console, or Zotero therefore feels
like switching applications.

## Goals

- Give the console shell and all six primary modules one shared native Codex
  typography and color contract.
- Match the measured native dark chat baseline: `#141414` canvas, 14 px / 20 px
  body text, 12 px / 16 px metadata, 17 px section titles, 20 px page titles,
  85% white primary text, and antialiased WebKit font smoothing.
- Use a restrained dark surface hierarchy derived from the native canvas rather
  than a bright dashboard-card hierarchy.
- Keep module navigation, controls, cards, inputs, list rows, empty states, and
  editor surfaces visually continuous with the conversation reader.
- Centralize the values as shared CSS custom properties so future modules do not
  invent another scale.
- Preserve the existing responsive layout and every feature interaction.

## Non-goals

- Reproducing private Codex component markup or application internals.
- Changing task, session, context, priority, remote-control, or Zotero data
  contracts and behavior.
- Removing information or redesigning module workflows in this increment.
- Making light mode pixel-identical to a specific native release. Light mode
  keeps the same shared typography and semantic surface hierarchy while retaining
  its existing light appearance.

## Visual contract

`public/styles/base.css` owns the shared native console tokens:

- typography family and measured body, metadata, section-title, page-title, and
  monospace scales;
- canvas, elevated surface, raised surface, hover surface, border, primary text,
  secondary text, tertiary text, and shadow roles;
- global antialiasing and explicit body line height.

`public/styles/theme.css` supplies the dark values for those roles. The dark
contract is:

- canvas `#141414`;
- elevated surface `#1b1b1d`;
- raised surface `#202022`;
- hover/selected surface `#29292b`;
- normal border `#303032` and stronger control border `#3c3c3f`;
- primary text `rgba(255,255,255,.85)`;
- secondary text `#a6a6ac` and tertiary text `#7f7f85`.

The top bar and module navigation may use a translucent canvas with blur, but
must compute to the native canvas family rather than the old `#1f1f20` shell.
Introduction cards become compact page headers: 20 px title, 14 px explanatory
copy, restrained padding, and no decorative gradient. Metrics and functional
cards use the shared raised surfaces and borders.

The conversation workspace consumes the same shared typography and dark canvas
tokens while retaining its conversation-specific layout variables. Execution
transcripts retain the measured 12.25 px / 22.75 px monospace scale.

## Accessibility and interaction

- Existing focus, hover, active, disabled, error, success, and in-progress states
  remain distinguishable.
- Text contrast stays at least as strong as the current dark theme.
- Click targets and responsive breakpoints do not shrink as part of typography
  alignment.
- No information or action is hidden by the visual migration.

## Verification

- Static regression tests assert the shared token values and that the shell,
  representative surfaces, inputs, session rows, and conversation reader consume
  them.
- `npm run check` and `npm test` pass without changing structure budgets.
- Browser verification visits all six modules in dark mode and confirms the
  computed canvas, font family, font size, line height, font smoothing, page-title
  scale, representative surface color, and border color.
- The remote conversation reader is rechecked to ensure its already-matched
  typography and execution transcript scale do not regress.

## Verification evidence

- All six dark modules computed to a `#141414` body canvas, 14 px / 20 px body
  typography, 20 px / 26 px page titles, 85% white primary text, and antialiased
  font smoothing in the running console.
- Representative functional surfaces computed to `#202022` with `#303032`
  borders; the device container uses the intended lower `#1b1b1d` elevation.
- Inputs computed to 14 px / 20 px for content or 12 px / 16 px for compact
  session filters, with the shared `#3c3c3f` control border.
- The six-module audit reported no document-level horizontal overflow at a
  1280 × 720 viewport. Visual inspection covered the session center and board.
- The remote conversation reader remained 14 px / 20 px on `#141414`; expanded
  execution detail remained 12.25 px / 22.75 px.
- `npm run check`, `git diff --check`, and all 174 tests passed.

## Rollback

Remove the shared native console token overrides and restore the previous base
and dark-theme values. This migration is presentation-only and does not modify
stored state or native Codex data.
