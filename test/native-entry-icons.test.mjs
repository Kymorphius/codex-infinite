import test from "node:test";
import assert from "node:assert/strict";
import { NATIVE_ENTRY_ICONS } from "../src/native-entry-icons.mjs";
import { buildInjectionScript } from "../src/injection.mjs";

test("all four entry icons are distinct, theme-aware and decorative", () => {
  assert.deepEqual(Object.keys(NATIVE_ENTRY_ICONS), ["console", "board", "sessions", "priority"]);
  assert.equal(new Set(Object.values(NATIVE_ENTRY_ICONS)).size, 4);
  for (const icon of Object.values(NATIVE_ENTRY_ICONS)) {
    assert.match(icon, /^<svg .*<\/svg>$/);
    for (const attribute of ['viewBox="0 0 24 24"', 'stroke="currentColor"', 'fill="none"',
      'width="1.1rem"', 'height="1.1rem"', 'aria-hidden="true"', 'focusable="false"']) {
      assert.ok(icon.includes(attribute), attribute);
    }
    assert.doesNotMatch(icon, /⌘|<script|<image|href=/);
  }
});

test("native entries retain module icons without a floating fallback", () => {
  const source = buildInjectionScript("http://127.0.0.1:47831");
  assert.doesNotMatch(source, /button\.innerHTML = entryIcons\[definition\.module\]/);
  for (const icon of Object.values(NATIVE_ENTRY_ICONS)) {
    assert.ok(source.includes(JSON.stringify(icon)), 'serialized injection preserves each module icon');
  }
  assert.match(source, /installNativeSidebarModuleEntries\(document, anchor, definitions, entryIcons,/);
  assert.doesNotMatch(source, /const iconMarkup/);
  assert.doesNotThrow(() => new Function(source));
});
