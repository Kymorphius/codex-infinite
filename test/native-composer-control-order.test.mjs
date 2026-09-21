import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeComposerControlOrderSource, normalizeNativeComposerControlOrder, reorderNativeComposerControlOrder } from "../src/native-composer-control-order.mjs";

test("composer control order normalizes stale local preferences to all known controls", () => {
  assert.deepEqual(normalizeNativeComposerControlOrder(["routing", "save", "routing", "unknown"]), ["routing", "save", "claim", "context"]);
  assert.deepEqual(normalizeNativeComposerControlOrder(null), ["save", "claim", "context", "routing"]);
});

test("composer control order moves a control before or after its drop target", () => {
  assert.deepEqual(reorderNativeComposerControlOrder(["save", "claim", "context", "routing"], "routing", "save"), ["routing", "save", "claim", "context"]);
  assert.deepEqual(reorderNativeComposerControlOrder(["save", "claim", "context", "routing"], "save", "context", true), ["claim", "context", "save", "routing"]);
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
  assert.match(source, /node\.draggable = false/);
  assert.match(source, /suppressClickUntil/);
  assert.doesNotMatch(source, /addEventListener\('dragstart'/);
});
