import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStaticAsset } from "../src/static-assets.mjs";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
const IMPORT = /(?:^|[;\s])(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gmu;

// A module that 404s breaks the whole browser module graph, so every relative
// import reachable from an HTML entry script must be an allowlisted asset.
test("every module reachable from dashboard entry scripts is served", () => {
  const entries = ["/app.js", "/features/runtime/sidebar.js"].filter((url) => resolveStaticAsset(url));
  const seen = new Set(), missing = [];
  const visit = (url, from) => {
    if (seen.has(url)) return;
    seen.add(url);
    const asset = resolveStaticAsset(url);
    if (!asset) { missing.push(`${url} (imported by ${from})`); return; }
    const file = path.join(publicRoot, asset.file);
    if (!existsSync(file)) return;
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const specifier = match[1] || match[2] || match[3];
      visit(new URL(specifier, `http://x${url}`).pathname, url);
    }
  };
  for (const entry of entries) visit(entry, "html");
  assert.ok(seen.has("/features/runtime/router-status.js"));
  assert.deepEqual(missing, []);
});
