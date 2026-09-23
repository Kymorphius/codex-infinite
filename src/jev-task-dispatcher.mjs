import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { supportsJevRoute } from "./jev-routing-policy.mjs";

const MAX_PROMPT_BYTES = 128 * 1024;

export class JevTaskDispatcher {
  constructor({ codexPath, codexHome = null, spawnImpl = spawn, exists = fs.existsSync, stat = fs.statSync, timeoutMs = 30_000 } = {}) {
    Object.assign(this, { codexPath, codexHome, spawnImpl, exists, stat, timeoutMs });
    this.children = new Set();
  }

  dispatch({ prompt: rawPrompt, cwd: rawCwd, model, effort }) {
    const prompt = typeof rawPrompt === "string" ? rawPrompt.trim() : "";
    if (!prompt || Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) throw new Error("任务内容无效");
    if (!supportsJevRoute(model, effort)) throw new Error("自动分流的模型或推理强度无效");
    const cwd = path.resolve(typeof rawCwd === "string" && rawCwd.trim() ? rawCwd.trim() : process.cwd());
    if (!this.exists(cwd) || !this.stat(cwd).isDirectory()) throw new Error("工作目录不存在或不是文件夹");
    const child = this.spawnImpl(this.codexPath, ["app-server"], {
      cwd,
      env: this.codexHome ? { ...process.env, CODEX_HOME: this.codexHome } : process.env,
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true
    });
    this.children.add(child);
    return new Promise((resolve, reject) => {
      const lines = readline.createInterface({ input: child.stdout });
      let settled = false;
      let threadId = null;
      let stderr = "";
      const send = (message) => child.stdin?.write(`${JSON.stringify(message)}\n`);
      const stop = () => { this.children.delete(child); lines.close(); if (child.exitCode === null && child.signalCode === null) child.kill(); };
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) { stop(); reject(error); } else resolve(value);
      };
      const timer = setTimeout(() => finish(new Error("Codex 未及时接受新任务")), this.timeoutMs);
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => { stderr = (stderr + chunk).slice(-12_000); });
      child.once("error", (error) => finish(error));
      child.once("close", (code) => {
        this.children.delete(child);
        if (!settled) finish(new Error(`Codex 在任务创建前退出（${code ?? "signal"}）${stderr ? `：${stderr.trim()}` : ""}`));
      });
      lines.on("line", (line) => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (message.error && [1, 2, 3].includes(message.id)) return finish(new Error(message.error.message || "Codex 拒绝了新任务"));
        if (message.id === 1) {
          send({ method: "initialized", params: {} });
          send({ id: 2, method: "thread/start", params: { cwd, ephemeral: false, model, approvalPolicy: "never" } });
        } else if (message.id === 2) {
          threadId = message.result?.thread?.id;
          if (!threadId) return finish(new Error("Codex 未返回新任务标识"));
          send({ id: 3, method: "turn/start", params: { threadId, input: [{ type: "text", text: prompt }], model, effort, turnTrigger: "jev-auto-route" } });
        } else if (message.id === 3) finish(null, { threadId, model, effort, cwd });
        else if (message.method === "turn/completed") stop();
      });
      send({ id: 1, method: "initialize", params: { clientInfo: { name: "codex_control_console_jev", title: "Codex Control Console Jev", version: "1.0.0" }, capabilities: { experimentalApi: true } } });
    });
  }

  close() {
    for (const child of this.children) if (child.exitCode === null && child.signalCode === null) child.kill();
    this.children.clear();
  }
}
