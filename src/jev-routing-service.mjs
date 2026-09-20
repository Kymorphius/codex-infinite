import fs from "node:fs";
import { spawn } from "node:child_process";
import { JEV_ROUTE_TIERS, JEV_TIER_DESCRIPTIONS, fallbackJevClassification, normalizeJevRoutingConfig } from "./jev-routing-policy.mjs";

const MAX_PROMPT_BYTES = 128 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;

function promptText(value) {
  const prompt = typeof value === "string" ? value.trim() : "";
  if (!prompt) throw new Error("请输入任务内容");
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) throw new Error("任务内容不能超过 128 KiB");
  return prompt;
}

function collect(child, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(result);
    };
    const append = (current, chunk) => {
      const next = current + String(chunk);
      if (Buffer.byteLength(next, "utf8") > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(new Error("Jev 返回内容过大"));
      }
      return next;
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error("Jev 判断超时")); }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(null, { code, stdout, stderr }));
    child.stdin?.end(input);
  });
}

export class JevRoutingService {
  constructor({ store, threadStore = null, jevPath, taskDispatcher, spawnImpl = spawn, exists = fs.existsSync, timeoutMs = 20_000 } = {}) {
    Object.assign(this, { store, threadStore, jevPath, taskDispatcher, spawnImpl, exists, timeoutMs });
  }

  async snapshot() {
    const threadState = await this.threadStore?.read?.();
    return { config: await this.store.read(), threadOverrides: threadState?.overrides || {}, available: Boolean(this.jevPath && this.exists(this.jevPath)) };
  }

  update(value) { return this.store.write(value); }

  async setEnabled(enabled) {
    const config = await this.store.read();
    const saved = await this.store.write({ ...config, enabled: enabled === true });
    await this.threadStore?.clear?.();
    return saved;
  }

  async setThreadEnabled(threadId, enabled) {
    if (!this.threadStore) throw new Error("当前会话自动分流存储不可用");
    await this.threadStore.set(threadId, enabled === true);
    return this.snapshot();
  }

  async classifyCurrent(rawPrompt) {
    return this.classify(rawPrompt, await this.store.read());
  }

  async classify(rawPrompt, configValue) {
    const prompt = promptText(rawPrompt);
    const config = normalizeJevRoutingConfig(configValue);
    if (!this.jevPath || !this.exists(this.jevPath)) return fallbackJevClassification(config, "Jev 未安装，已使用兜底档位");
    const args = ["pick", "Choose the smallest Codex capability tier that can reliably complete this task.", ...JEV_ROUTE_TIERS.map((tier) => `${tier}=${JEV_TIER_DESCRIPTIONS[tier]}`), "--min-confidence", String(config.minConfidence), "--json"];
    let result;
    try { result = await collect(this.spawnImpl(this.jevPath, args, { env: process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true }), prompt, this.timeoutMs); }
    catch (error) { return fallbackJevClassification(config, `${error.message}，已使用兜底档位`); }
    let parsed;
    try { parsed = JSON.parse(result.stdout.trim()); } catch {}
    const classifiedTier = parsed?.answer?.choice;
    const confidence = Number(parsed?.answer?.confidence);
    if (result.code === 2 || !JEV_ROUTE_TIERS.includes(classifiedTier) || !Number.isFinite(confidence)) return fallbackJevClassification(config, "Jev 判断失败，已使用兜底档位");
    if (result.code === 1 || confidence < config.minConfidence) return fallbackJevClassification(config, `Jev 置信度 ${confidence.toFixed(2)} 低于阈值，已使用兜底档位`, { classifiedTier, confidence });
    return { tier: classifiedTier, classifiedTier, confidence, fallback: false, reason: `Jev 以 ${confidence.toFixed(2)} 置信度选择 ${classifiedTier}`, ...config.mappings[classifiedTier] };
  }

  async dispatch({ prompt: rawPrompt, cwd }) {
    const prompt = promptText(rawPrompt);
    const config = await this.store.read();
    const classification = await this.classify(prompt, config);
    const task = await this.taskDispatcher.dispatch({ prompt, cwd, model: classification.model, effort: classification.effort });
    return { ...task, classification };
  }
}
