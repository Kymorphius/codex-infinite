import test from "node:test";
import assert from "node:assert/strict";
import { createLegacyTerminalFeature as createTerminalFeature } from "../public/features/terminal/legacy.js";

const settle = () => new Promise((resolve) => setImmediate(resolve));
const session = (id, cwd) => ({ id, cwd, title: id, kind: "shell", status: "running", cols: 80, rows: 24 });

function harness(t, url = "http://127.0.0.1:47831/?module=terminal") {
  const elements = new Map(), requests = [], sockets = [], terminals = [], values = new Map();
  const originals = new Map();
  function install(key, value) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  class Element {
    constructor() {
      const classes = new Set();
      this.classList = {
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); }
      };
      this.attributes = new Map(); this.children = []; this.dataset = {}; this.style = {};
      this.value = ""; this.textContent = ""; this.scrollHeight = 58; this.listeners = new Map();
    }
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key); }
    replaceChildren(...children) { this.children = children; }
    append(child) { this.children.push(child); }
    querySelector(selector) { return $(selector); }
    querySelectorAll() { return []; }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    getBoundingClientRect() { return { width: 800, height: 500 }; }
    focus() { this.focused = true; }
    close() { this.open = false; }
    remove() { this.removed = true; }
  }
  function $(selector) {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  }
  class Terminal {
    constructor(options) { this.options = options; terminals.push(this); }
    loadAddon() {}
    open(host) { this.host = host; }
    onData() { return { dispose() {} }; }
    resize() {}
    reset() {}
    write(data, callback) { callback?.(); }
    focus() {}
    dispose() { this.disposed = true; }
  }
  class Socket {
    constructor(value) { this.url = value; this.readyState = 1; sockets.push(this); }
    send() {}
    close() { this.readyState = 3; }
  }
  const location = new URL(url);
  install("location", location);
  install("history", { replaceState(state, title, value) { location.href = new URL(value, location).href; } });
  install("document", { createElement: () => new Element() });
  install("sessionStorage", { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) });
  install("Terminal", Terminal);
  install("FitAddon", { FitAddon: class { fit() {} } });
  install("WebSocket", Socket);
  install("ResizeObserver", class { observe() {} disconnect() {} });
  install("fetch", (requestedUrl, options) => new Promise((resolve, reject) => {
    requests.push({ url: requestedUrl, options, reject, respond(sessions) { resolve({ ok: true, json: async () => ({ sessions, defaultCwd: "/home" }) }); } });
  }));
  const state = { module: "terminal", projects: [], tasks: [], devices: [{ id: "local", kind: "local-codex" }] };
  const create = () => createTerminalFeature({ state, $, showToast() {} });
  let feature = create();
  t.after(() => {
    try { feature.dispose(); }
    finally {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  });
  return {
    get feature() { return feature; }, $, location, requests, sockets, terminals,
    selected: () => $('[data-testid="terminal-tabs"]').children.filter((item) => item.getAttribute("aria-selected") === "true").map((item) => item.dataset.terminalId),
    reload() { feature.dispose(); feature = create(); feature.bind(); },
    error: () => $('[data-testid="terminal-error"]').textContent
  };
}

test("an invalid reference invalidates a pending list without activating a stale terminal or clearing its error", async (t) => {
  const h = harness(t);
  const loading = h.feature.load();
  assert.equal(h.requests.length, 1);
  assert.equal(h.feature.openReference({ provider: "terminal", cwd: "relative" }), false);
  const error = h.error();
  assert.match(error, /目录无效/u);
  h.requests[0].respond([session("stale", "/old")]);
  await loading;
  await settle();
  assert.equal(h.error(), error);
  assert.equal(h.$('[data-testid="terminal-error"]').classList.contains("hidden"), false);
  assert.deepEqual(h.selected(), []);
  assert.equal(h.terminals.length, 0);
  assert.equal(h.sockets.length, 0);
  assert.equal(h.requests.length, 1);
});

test("a newer valid reference queues a fresh list and only activates that reference after the stale result is ignored", async (t) => {
  const h = harness(t);
  const loading = h.feature.load();
  assert.equal(h.feature.openReference({ provider: "terminal", cwd: "/new", sessionId: "new-one", projectName: "New project" }), true);
  assert.equal(h.requests.length, 1);
  h.requests[0].respond([session("old-one", "/old"), session("new-one", "/new")]);
  await loading;
  await settle();
  assert.equal(h.requests.length, 2);
  assert.equal(h.terminals.length, 0);
  assert.equal(h.sockets.length, 0);
  assert.deepEqual(h.selected(), []);
  h.requests[1].respond([session("old-one", "/old"), session("new-one", "/new"), session("new-two", "/new")]);
  await settle();
  assert.deepEqual(h.selected(), ["new-one"]);
  assert.equal(h.terminals.length, 1);
  assert.equal(h.sockets.length, 1);
  assert.equal(new URL(h.sockets[0].url).searchParams.get("id"), "new-one");
  assert.equal(h.location.searchParams.get("session"), "new-one");
  assert.equal(h.location.searchParams.get("cwd"), "/new");
  assert.equal(h.error(), "");
  assert.ok(h.requests.every((request) => request.url === "/api/terminal/list" && request.options.method === "POST"));
});

test("a missing explicit session stays in the URL across another load and page reload without falling back", async (t) => {
  const h = harness(t, "http://127.0.0.1:47831/?module=terminal&session=missing&cwd=%2Fproject");
  const available = [session("other", "/project"), session("elsewhere", "/elsewhere")];
  const assertMissing = () => {
    assert.equal(h.location.searchParams.get("session"), "missing");
    assert.equal(h.location.searchParams.get("cwd"), "/project");
    assert.match(h.error(), /已关闭|不属于/u);
    assert.deepEqual(h.selected(), []);
    assert.equal(h.terminals.length, 0);
    assert.equal(h.sockets.length, 0);
  };
  h.feature.bind();
  assert.equal(h.requests.length, 1);
  h.requests[0].respond(available);
  await settle();
  assertMissing();
  const loading = h.feature.load();
  assert.equal(h.requests.length, 2);
  h.requests[1].respond(available);
  await loading;
  assertMissing();
  h.reload();
  assert.equal(h.requests.length, 3);
  h.requests[2].respond(available);
  await settle();
  assertMissing();
});
