import { spawn as nodeSpawn } from "node:child_process";
import readline from "node:readline";

export class AppServerClient {
  constructor({ codexPath, codexHome, spawnImpl = nodeSpawn, timeoutMs = 10_000 }) {
    this.timeoutMs = timeoutMs;
    this.child = spawnImpl(codexPath, ["app-server", "--analytics-default-enabled"], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, CODEX_HOME: codexHome } });
    this.nextId = 1;
    this.pending = new Map();
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    this.child.once("exit", () => this.failPending(new Error("Codex app-server 已退出")));
    this.child.once("error", (error) => this.failPending(error));
  }

  handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id == null || !this.pending.has(message.id)) return;
    const pending = this.pending.get(message.id);
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message || "Codex app-server 请求失败"));
    else pending.resolve(message.result);
  }

  failPending(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex app-server 请求超时: ${method}`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  async initialize() {
    return this.request("initialize", { clientInfo: { name: "codex-control-console", title: "Codex Control Console", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  }

  close() {
    this.lines.close();
    this.child.stdin.end();
    this.child.kill("SIGTERM");
  }
}
