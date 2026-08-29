import test from "node:test";
import assert from "node:assert/strict";
import { STATIC_ASSET_CSP, resolveStaticAsset, serveStaticAsset } from "../src/static-assets.mjs";
import { createDashboardServer } from "../src/http-server.mjs";

function responseRecorder() {
  return {
    statusCode: null,
    headers: null,
    body: Symbol("not-ended"),
    writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; },
    end(body) { this.body = body; }
  };
}

test("static assets resolve only exact registered request targets", () => {
  assert.equal(resolveStaticAsset("/").file, "index.html");
  assert.equal(resolveStaticAsset("/styles.css?v=1").type, "text/css; charset=utf-8");
  assert.equal(resolveStaticAsset("/features/sessions/index.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/missing.js"), null);
  assert.equal(resolveStaticAsset("/../package.json"), null);
  assert.equal(resolveStaticAsset("/%2e%2e/package.json"), null);
  assert.equal(resolveStaticAsset("/features/%2e%2e/app.js"), null);
  assert.equal(resolveStaticAsset("/%ZZ"), null);
});

test("static GET uses trusted path, MIME, and security headers", async () => {
  const response = responseRecorder();
  let readPath;
  const handled = await serveStaticAsset(
    { method: "GET", url: "/app.js?cache-bust=1" },
    response,
    { async readFile(filePath) { readPath = filePath; return Buffer.from("module"); } }
  );

  assert.equal(handled, true);
  assert.match(readPath, /public\/app\.js$/);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/javascript; charset=utf-8");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["content-security-policy"], STATIC_ASSET_CSP);
  assert.equal(response.body.toString(), "module");
});

test("static HEAD sends successful headers without a body", async () => {
  const response = responseRecorder();
  const handled = await serveStaticAsset(
    { method: "HEAD", url: "/index.html" },
    response,
    { async readFile() { return Buffer.from("hidden"); } }
  );

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(response.body, undefined);
});

test("dashboard preserves static method and missing-route behavior", async (t) => {
  const adapter = { async listTasks() { return { status: "connected", tasks: [], projects: [] }; }, async getTask() { return null; } };
  const config = {
    dashboardHost: "127.0.0.1", dashboardPort: 0, dashboardOrigin: "http://127.0.0.1:0",
    cdpHost: "127.0.0.1", cdpPort: 9231, cdpOrigin: "http://127.0.0.1:9231", profileDirectory: "/tmp/codex-static-test"
  };
  const dashboard = createDashboardServer({ config, adapter });
  await dashboard.listen();
  t.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.server.address().port}`;

  const known = await fetch(`${origin}/features/console/index.js`);
  assert.equal(known.status, 200);
  assert.match(known.headers.get("content-type"), /^text\/javascript/);
  const head = await fetch(`${origin}/`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await fetch(`${origin}/missing.js`)).status, 404);
  assert.equal((await fetch(`${origin}/app.js`, { method: "POST" })).status, 405);
});
