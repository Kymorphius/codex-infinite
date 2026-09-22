import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeAttentionStickyInjectionScript } from "../src/native-attention-sticky.mjs";

test("retired attention sticky injection removes every legacy marker and style", () => {
  const source = buildNativeAttentionStickyInjectionScript();
  assert.match(source, /data-codex-control-console-attention-sticky/);
  assert.match(source, /document\.documentElement\.removeAttribute\(FOCUS_MARKER\)/);
  assert.match(source, /delete window\.__codexControlConsoleAttentionStickyFocusListener/);
  assert.match(source, /removeEventListener\('focus'/);
  assert.match(source, /removeEventListener\('blur'/);
  assert.match(source, /querySelectorAll\(STYLE_SELECTOR\).*remove/);
  assert.match(source, /AttentionStickyObserver = null/);
  assert.doesNotMatch(source, /position:sticky|MutationObserver|requestAnimationFrame/);
});
