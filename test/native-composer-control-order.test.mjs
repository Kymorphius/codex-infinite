import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeComposerControlOrderSource, normalizeNativeComposerControlOrder, reorderNativeComposerControlOrder } from "../src/native-composer-control-order.mjs";

test("composer control order normalizes stale local preferences to all known controls", () => {
  assert.deepEqual(normalizeNativeComposerControlOrder(["routing", "save", "routing", "unknown"]), ["state", "queue", "routing", "save", "claim", "context"]);
  assert.deepEqual(normalizeNativeComposerControlOrder(null), ["state", "queue", "save", "claim", "context", "routing"]);
});

test("composer control order moves a control before or after its drop target", () => {
  assert.deepEqual(reorderNativeComposerControlOrder(["state", "queue", "save", "claim", "context", "routing"], "routing", "save"), ["state", "queue", "routing", "save", "claim", "context"]);
  assert.deepEqual(reorderNativeComposerControlOrder(["state", "queue", "save", "claim", "context", "routing"], "state", "context", true), ["queue", "save", "claim", "context", "state", "routing"]);
});

test("composer control order source uses modifier pointer movement without native HTML drag", () => {
  const source = buildNativeComposerControlOrderSource();
  assert.match(source, /event\.metaKey && !event\.ctrlKey/);
  assert.match(source, /addEventListener\('pointermove'/);
  assert.match(source, /addEventListener\('pointerup'/);
  assert.match(source, /Math\.hypot/);
  assert.match(source, /setPointerCapture/);
  const pointerDown = source.slice(source.indexOf('const onPointerDown'), source.indexOf('const onPointerMove'));
  assert.match(pointerDown, /event\.preventDefault\(\)/);
  assert.match(pointerDown, /event\.stopImmediatePropagation\(\)/);
  assert.match(pointerDown, /suppressClickUntil = Date\.now\(\) \+ 1500/);
  assert.match(source, /composer-control-order\.v1/);
  assert.match(source, /data-ccc-control-drag-armed/);
  assert.match(source, /data-ccc-held-queue-button/);
  assert.match(source, /data-codex-control-console-turn-state/);
  assert.match(source, /data-ccc-composer-control-order-style/);
  assert.match(source, /data-ccc-control-dragging/);
  assert.match(source, /cursor:grabbing/);
  assert.match(source, /__codexControlConsoleComposerControlOrderVersion/);
  assert.match(source, /else window\.__codexControlConsoleComposerControlOrder\.apply\(\)/);
  assert.match(source, /node\.getAttribute\('draggable'\) !== 'false'/);
  assert.match(source, /record\.target\?\.matches\?\.\(selector\)/);
  assert.doesNotMatch(source, /record\.type === 'attributes' \|\|/);
  assert.match(source, /suppressClickUntil/);
  assert.doesNotMatch(source, /addEventListener\('dragstart'/);
});
