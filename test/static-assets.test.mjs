import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { composeHtml, STATIC_ASSET_CSP, resolveStaticAsset, serveStaticAsset } from "../src/static-assets.mjs";
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
  for (const name of ["base", "tasks", "sessions-priority", "approvals", "execution", "conversation", "states", "zotero", "theme", "responsive"]) {
    const asset = resolveStaticAsset(`/styles/${name}.css?v=1`);
    assert.equal(asset.file, `styles/${name}.css`);
    assert.equal(asset.type, "text/css; charset=utf-8");
  }
  assert.equal(resolveStaticAsset("/styles.css"), null);
  assert.equal(resolveStaticAsset("/styles/missing.css"), null);
  assert.equal(resolveStaticAsset("/core/dom.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/theme.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/core/format.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/core/navigation.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/core/state.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/core/tasks.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/core/refresh-policy.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/core/transport.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/features/context/index.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/features/dispatch/index.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/features/sessions/index.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/features/sessions/remote-conversation.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/features/sessions/remote-approvals.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/features/sessions/settings-controller.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/features/sessions/approval-model.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/features/sessions/conversation-model.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/features/sessions/execution-view.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/features/sessions/disclosure.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/features/sessions/model.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/features/zotero/index.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/features/zotero/browser.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/features/zotero/editor.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/features/zotero/format.js").type, "text/javascript; charset=utf-8");
  assert.equal(resolveStaticAsset("/panels/board.html"), null);
  assert.equal(resolveStaticAsset("/missing.js"), null);
  assert.equal(resolveStaticAsset("/../package.json"), null);
  assert.equal(resolveStaticAsset("/%2e%2e/package.json"), null);
  assert.equal(resolveStaticAsset("/features/%2e%2e/app.js"), null);
  assert.equal(resolveStaticAsset("/styles/%2e%2e/index.html"), null);
  assert.equal(resolveStaticAsset("/%ZZ"), null);
});

test("console modules and conversation share the measured native visual system", async () => {
  const base = await fs.readFile(resolveStaticAsset("/styles/base.css").path, "utf8");
  const tasks = await fs.readFile(resolveStaticAsset("/styles/tasks.css").path, "utf8");
  const sessions = await fs.readFile(resolveStaticAsset("/styles/sessions-priority.css").path, "utf8");
  const conversation = await fs.readFile(resolveStaticAsset("/styles/conversation.css").path, "utf8");
  const execution = await fs.readFile(resolveStaticAsset("/styles/execution.css").path, "utf8");
  const zotero = await fs.readFile(resolveStaticAsset("/styles/zotero.css").path, "utf8");
  const theme = await fs.readFile(resolveStaticAsset("/styles/theme.css").path, "utf8");
  const settingsController = await fs.readFile(resolveStaticAsset("/features/sessions/settings-controller.js").path, "utf8");
  assert.match(base, /--native-ui-body-size:\s*14px/);
  assert.match(base, /--native-ui-body-line:\s*20px/);
  assert.match(base, /--native-ui-meta-size:\s*12px/);
  assert.match(base, /--native-ui-page-title-size:\s*20px/);
  assert.match(base, /--native-ui-code-size:\s*12\.25px/);
  assert.match(base, /--native-ui-dark-canvas:\s*#141414/);
  assert.match(base, /--native-ui-dark-text:\s*rgba\(255,255,255,\.85\)/);
  assert.match(base, /-webkit-font-smoothing:\s*antialiased/);
  assert.match(conversation, /--native-chat-body-size:\s*var\(--native-ui-body-size\)/);
  assert.match(conversation, /--native-chat-dark-background:\s*var\(--native-ui-dark-canvas\)/);
  assert.match(conversation, /font-size:\s*var\(--native-chat-body-size\)/);
  assert.match(conversation, /\.conversation-setting\s*\{/);
  assert.match(conversation, /font-size:\s*var\(--native-chat-meta-size\)/);
  assert.match(execution, /font:\s*500 var\(--native-chat-code-size\)\/var\(--native-chat-code-line\)/);
  assert.match(execution, /font-size:\s*var\(--native-chat-meta-size\)/);
  assert.match(tasks, /font-size:\s*var\(--native-ui-meta-size\)/);
  assert.match(sessions, /font-size:\s*var\(--native-ui-page-title-size\)/);
  assert.match(zotero, /font:\s*500 var\(--native-ui-body-size\)\/var\(--native-ui-body-line\)/);
  assert.match(theme, /--native-ui-canvas:\s*var\(--native-ui-dark-canvas\)/);
  assert.match(theme, /--native-ui-surface-raised:\s*#202022/);
  assert.match(theme, /--native-ui-border:\s*#303032/);
  assert.match(theme, /background:\s*var\(--native-chat-dark-background\)/);
  assert.match(theme, /color:\s*var\(--native-chat-dark-text\)/);
  assert.match(settingsController, /event\.stopImmediatePropagation\(\)/);
});

test("HTML shell composition is ordered and requires one exact marker", () => {
  assert.equal(composeHtml("<main><!-- MODULE_PANELS --></main>", ["<a>A</a>", "<b>B</b>"]), "<main><a>A</a>\n<b>B</b></main>");
  assert.throws(() => composeHtml("<main></main>", []), /exactly one module marker/);
  assert.throws(() => composeHtml("<!-- MODULE_PANELS --><!-- MODULE_PANELS -->", []), /exactly one module marker/);
});

test("index GET assembles only the fixed private panel files", async () => {
  const response = responseRecorder();
  const reads = [];
  await serveStaticAsset({ method: "GET", url: "/" }, response, {
    async readFile(filePath) {
      reads.push(filePath);
      if (filePath.endsWith("index.html")) return Buffer.from("<main><!-- MODULE_PANELS --></main>");
      return Buffer.from(`<section>${filePath.split("/").at(-1)}</section>`);
    }
  });
  assert.equal(reads.length, 7);
  assert.match(response.body.toString(), /board\.html.*context\.html.*zotero\.html/s);
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
    { async readFile() { throw new Error("HEAD must not read template files"); } }
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
  const shell = await (await fetch(`${origin}/`)).text();
  assert.match(shell, /data-testid="session-approval-list"/);
  assert.match(shell, /data-testid="session-remote-settings"/);
  assert.match(shell, /styles\/approvals\.css/);
  assert.match(shell, /styles\/execution\.css/);
  const head = await fetch(`${origin}/`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await fetch(`${origin}/missing.js`)).status, 404);
  assert.equal((await fetch(`${origin}/app.js`, { method: "POST" })).status, 405);
});
