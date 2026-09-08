import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectCopyReceiptStore } from "../src/project-copy-receipts.mjs";

test("project copy receipts persist bounded private lineage", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "copy-receipts-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "receipts.json");
  const store = new ProjectCopyReceiptStore({ filePath });
  for (let index = 0; index < 102; index += 1) await store.append({ copyId: String(index), status: "completed" });
  const result = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.equal(result.copies.length, 100);
  assert.equal(result.copies.at(-1).copyId, "101");
  assert.equal((await fs.stat(filePath)).mode & 0o077, 0);
});
