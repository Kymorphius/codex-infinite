import test from "node:test";
import assert from "node:assert/strict";
import { readNativeComposerThreadId } from "../src/native-composer-thread-id.mjs";

const localId = "01a0ac42-2552-7141-8ec9-12c50515ac4a";

test("native composer thread identity prefers the last mounted composer", () => {
  const documentRef = {
    querySelectorAll() { return [{ getAttribute: () => "bad" }, { getAttribute: () => localId }]; },
    querySelector() { throw new Error("sidebar fallback should not run"); }
  };
  assert.equal(readNativeComposerThreadId(documentRef), localId);
});

test("native composer thread identity falls back to the selected local sidebar row", () => {
  const documentRef = {
    querySelectorAll() { return []; },
    querySelector() { return { getAttribute: () => `local:${localId.toUpperCase()}` }; }
  };
  assert.equal(readNativeComposerThreadId(documentRef), localId);
});

test("native composer thread identity fails closed when no local thread is selected", () => {
  const documentRef = { querySelectorAll() { return []; }, querySelector() { return null; } };
  assert.equal(readNativeComposerThreadId(documentRef), null);
});

test("native composer thread resolver is self-contained for injected scripts", () => {
  assert.doesNotThrow(() => new Function(`return (${readNativeComposerThreadId.toString()});`));
});
