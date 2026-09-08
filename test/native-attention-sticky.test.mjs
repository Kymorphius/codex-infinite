import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeAttentionStickyInjectionScript, NATIVE_ATTENTION_HEADINGS } from "../src/native-attention-sticky.mjs";

test("attention sticky headings use the exact attention-layer allowlist", () => {
  assert.deepEqual(NATIVE_ATTENTION_HEADINGS, ["现在", "等待", "本周", "待整理"]);
  const source = buildNativeAttentionStickyInjectionScript();
  for (const heading of NATIVE_ATTENTION_HEADINGS) assert.match(source, new RegExp(heading));
  assert.doesNotMatch(source, /远端设备.*项目.*Projects/);
});

test("attention sticky injection owns only a scoped style and marker", () => {
  const source = buildNativeAttentionStickyInjectionScript();
  assert.match(source, /data-codex-control-console-attention-sticky/);
  assert.match(source, /position:sticky !important/);
  assert.match(source, /top:8px !important/);
  assert.doesNotMatch(source, /background:|::before|::after|isolation:|border:|box-shadow:/);
  assert.match(source, /document\.documentElement\.removeAttribute\(FOCUS_MARKER\)/);
  assert.match(source, /delete window\.__codexControlConsoleAttentionStickyFocusListener/);
  assert.doesNotMatch(source, /addEventListener\('(focus|blur)'/);
  assert.match(source, /removeEventListener\('focus'/);
  assert.match(source, /removeEventListener\('blur'/);
  assert.doesNotMatch(source, /color-mix\(in srgb, var\(--color-surface-tertiary/);
  assert.doesNotMatch(source, /box-shadow/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /data-app-action-sidebar-section-toggle/);
  assert.match(source, /nav-section-title/);
  assert.doesNotMatch(source, /appendChild\(section/);
  assert.doesNotMatch(source, /insertBefore\(section/);
  assert.doesNotMatch(source, /replaceWith\(section/);
});
