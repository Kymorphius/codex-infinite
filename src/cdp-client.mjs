import { assertLoopbackUrl } from "./loopback.mjs";

function asText(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data ?? "");
}

export async function fetchJson(url, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  assertLoopbackUrl(url, "CDP URL");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export class CdpConnection {
  constructor(webSocketUrl, { webSocketFactory, commandTimeoutMs = 8000 } = {}) {
    const parsed = new URL(webSocketUrl);
    if (parsed.hostname !== "127.0.0.1") {
      throw new Error(`CDP websocket must use 127.0.0.1; received ${parsed.hostname}`);
    }
    this.webSocketUrl = webSocketUrl;
    this.webSocketFactory = webSocketFactory || ((url) => {
      if (typeof globalThis.WebSocket !== "function") {
        throw new Error("This Node runtime does not provide the WebSocket API");
      }
      return new globalThis.WebSocket(url);
    });
    this.commandTimeoutMs = commandTimeoutMs;
    this.socket = null;
    this.nextId = 0;
    this.pending = new Map();
    this.eventHandlers = new Set();
    this.openPromise = null;
  }

  onEvent(handler) {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  async connect() {
    if (this.socket?.readyState === 1) return this;
    if (this.openPromise) return this.openPromise;

    this.openPromise = new Promise((resolve, reject) => {
      let settled = false;
      const socket = this.webSocketFactory(this.webSocketUrl);
      this.socket = socket;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const opened = () => {
        if (settled) return;
        settled = true;
        resolve(this);
      };
      const message = (event) => {
        try {
          const payload = JSON.parse(asText(event?.data ?? event));
          if (payload.id !== undefined) {
            const waiter = this.pending.get(payload.id);
            if (!waiter) return;
            this.pending.delete(payload.id);
            clearTimeout(waiter.timeout);
            if (payload.error) waiter.reject(new Error(payload.error.message || "CDP command failed"));
            else waiter.resolve(payload.result);
            return;
          }
          for (const handler of this.eventHandlers) handler(payload);
        } catch (error) {
          for (const handler of this.eventHandlers) handler({ method: "__codex_control_console_parse_error", error });
        }
      };
      const closed = () => {
        const error = new Error("CDP websocket closed");
        for (const waiter of this.pending.values()) {
          clearTimeout(waiter.timeout);
          waiter.reject(error);
        }
        this.pending.clear();
        if (!settled) fail(error);
      };

      if (typeof socket.addEventListener === "function") {
        socket.addEventListener("open", opened, { once: true });
        socket.addEventListener("message", message);
        socket.addEventListener("error", fail, { once: true });
        socket.addEventListener("close", closed, { once: true });
      } else {
        socket.onopen = opened;
        socket.onmessage = message;
        socket.onerror = fail;
        socket.onclose = closed;
      }
    }).finally(() => {
      this.openPromise = null;
    });

    return this.openPromise;
  }

  async send(method, params = {}, sessionId = undefined) {
    await this.connect();
    const id = ++this.nextId;
    const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, this.commandTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(payload);
    });
  }

  async evaluate(expression, options = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      ...options
    });
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
    }
    return result?.result?.value;
  }

  async close() {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("CDP connection closed by caller"));
    }
    this.pending.clear();
    this.eventHandlers.clear();
    if (this.socket && this.socket.readyState < 2) this.socket.close();
    this.socket = null;
  }
}

export async function discoverTargets(cdpOrigin, options = {}) {
  return fetchJson(`${cdpOrigin}/json/list`, options);
}

export function chooseMainTarget(targets) {
  const candidates = targets.filter((target) => (
    target?.type === "page" &&
    typeof target.url === "string" &&
    /^app:\/\/-\/index\.html(?:\?|$)/.test(target.url) &&
    typeof target.webSocketDebuggerUrl === "string"
  ));
  if (candidates.length === 0) {
    throw new Error("No Codex app page target is available on the loopback CDP endpoint");
  }
  candidates.sort((left, right) => {
    const leftExact = left.url === "app://-/index.html" ? 0 : 1;
    const rightExact = right.url === "app://-/index.html" ? 0 : 1;
    return leftExact - rightExact;
  });
  return candidates[0];
}
