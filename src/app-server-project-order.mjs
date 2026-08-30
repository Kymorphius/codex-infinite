import { spawn as nodeSpawn } from "node:child_process";
import readline from "node:readline";
import { buildNativeProjectOrder, projectMovePlan } from "./project-order.mjs";

class AppServerClient {
  constructor({ codexPath, codexHome, spawnImpl = nodeSpawn, timeoutMs = 10000 }) {
    this.timeoutMs = timeoutMs;
    this.child = spawnImpl(codexPath, ["app-server", "--analytics-default-enabled"], {
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, CODEX_HOME: codexHome }
    });
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
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server 请求超时: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  close() {
    this.lines.close();
    this.child.stdin.end();
    this.child.kill("SIGTERM");
  }
}

export class AppServerProjectOrder {
  constructor({ codexPath, codexHome, spawnImpl, logger = console, timeoutMs } = {}) {
    this.codexPath = codexPath;
    this.codexHome = codexHome;
    this.spawnImpl = spawnImpl;
    this.logger = logger;
    this.timeoutMs = timeoutMs;
  }

  async apply(tasks, now = new Date()) {
    const client = new AppServerClient({
      codexPath: this.codexPath,
      codexHome: this.codexHome,
      spawnImpl: this.spawnImpl,
      timeoutMs: this.timeoutMs
    });
    try {
      await client.request("initialize", {
        clientInfo: { name: "codex-control-console", title: "Codex Control Console", version: "0.1.0" },
        capabilities: { experimentalApi: true }
      });
      const projects = [];
      let cursor = null;
      do {
        const page = await client.request("project/list", { cursor, limit: 100 });
        if (!Array.isArray(page?.data)) throw new Error("Codex 返回了无效的项目列表");
        projects.push(...page.data);
        cursor = page.nextCursor || null;
      } while (cursor);
      const ordered = buildNativeProjectOrder(projects, tasks, now);
      const moves = projectMovePlan(projects, ordered);
      for (const move of moves) await client.request("project/move", move);
      return {
        changed: moves.length > 0,
        projectCount: projects.length,
        moveCount: moves.length,
        order: ordered.map(({ project, score }) => ({ id: project.id, name: project.name, priorityScore: score?.priorityScore ?? null }))
      };
    } finally {
      client.close();
    }
  }
}
