import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { JEV_ROUTE_EFFORTS, JEV_ROUTE_MODELS, JEV_ROUTE_TIERS, JEV_TIER_DESCRIPTIONS, fallbackJevClassification, normalizeJevRoutingConfig } from "./jev-routing-policy.mjs";
import { jevHybridRequest, resolveJevHybridAnswer } from "./jev-hybrid-policy.mjs";

const MAX_PROMPT_BYTES = 128 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeJevRoutingReceipt(value) {
  const threadId = String(value?.threadId || "").toLowerCase();
  const turnId = String(value?.turnId || "").toLowerCase();
  if (!UUID.test(threadId) || !UUID.test(turnId) || !JEV_ROUTE_MODELS.includes(value?.model) || !JEV_ROUTE_EFFORTS.includes(value?.effort)) return null;
  return {
    threadId,
    turnId,
    tier: String(value?.tier || "").slice(0, 24),
    model: value.model,
    effort: value.effort,
    confidence: Number.isFinite(value?.confidence) ? value.confidence : null,
    lowConfidence: value?.lowConfidence === true,
    fallback: value?.fallback === true,
    source: ["jev", "dimensions", "fallback", "inherited"].includes(value?.source) ? value.source : null,
    dimensionScore: Number.isFinite(value?.dimensionScore) && value.dimensionScore >= 0 && value.dimensionScore <= 30 ? value.dimensionScore : null,
    dimensionConfidence: Number.isFinite(value?.dimensionConfidence) && value.dimensionConfidence >= 0 && value.dimensionConfidence <= 1 ? value.dimensionConfidence : null,
    reason: String(value?.reason || "").slice(0, 500),
    routedAt: String(value?.routedAt || "").slice(0, 64)
  };
}

export async function readJevRoutingReceipts(directory) {
  if (!directory) return [];
  let names;
  try { names = await fs.promises.readdir(directory); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const receipts = [];
  for (const name of names.filter((value) => /^[0-9a-f-]{36}\.json$/i.test(value)).slice(-512)) {
    try {
      const receipt = normalizeJevRoutingReceipt(JSON.parse(await fs.promises.readFile(path.join(directory, name), "utf8")));
      if (receipt) receipts.push(receipt);
    } catch {}
  }
  return receipts;
}

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
    child.stdin?.on("error", (error) => finish(error));
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(null, { code, stdout, stderr }));
    child.stdin?.end(input);
  });
}

export class JevRoutingService {
  constructor({ store, threadStore = null, transportManager = null, receiptDirectory = null, jevPath, taskDispatcher, spawnImpl = spawn, exists = fs.existsSync, timeoutMs = 20_000, platform = process.platform } = {}) {
    Object.assign(this, { store, threadStore, transportManager, receiptDirectory, jevPath, taskDispatcher, spawnImpl, exists, timeoutMs, platform });
    this.receiptCache = null;
  }

  async initialize() { return this.transportManager?.apply?.((await this.store.read()).transportMode); }

  async snapshot() {
    const threadState = await this.threadStore?.read?.();
    const config = await this.store.read();
    await this.transportManager?.apply?.(config.transportMode);
    let directoryVersion = "missing";
    if (this.receiptDirectory) {
      try { directoryVersion = (await fs.promises.stat(this.receiptDirectory, { bigint: true })).mtimeNs.toString(); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    if (!this.receiptCache || this.receiptCache.directoryVersion !== directoryVersion || Date.now() - this.receiptCache.loadedAt > 60_000) {
      this.receiptCache = { directoryVersion, loadedAt: Date.now(), receipts: await readJevRoutingReceipts(this.receiptDirectory) };
    }
    return { config, threadOverrides: threadState?.overrides || {}, receipts: this.receiptCache.receipts, transport: this.transportManager?.status?.() || null, available: Boolean(this.jevPath && this.exists(this.jevPath)) };
  }

  async update(value) {
    const config = await this.store.write(value);
    await this.transportManager?.apply?.(config.transportMode);
    return config;
  }

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
    const config = await this.store.read();
    await this.transportManager?.apply?.(config.transportMode);
    return this.classify(rawPrompt, config);
  }

  async classify(rawPrompt, configValue) {
    const prompt = promptText(rawPrompt);
    const config = normalizeJevRoutingConfig(configValue);
    if (!this.jevPath || !this.exists(this.jevPath)) return fallbackJevClassification(config, "Jev 未安装，已使用兜底档位");
    const args = ["raw"];
    let result;
    const windowsCommand = this.platform === "win32" && /\.cmd$/i.test(this.jevPath || "");
    const command = windowsCommand ? (process.env.ComSpec || "cmd.exe") : this.jevPath;
    const commandArgs = windowsCommand ? ["/d", "/s", "/c", `\"${this.jevPath}\"`, ...args] : args;
    try { result = await collect(this.spawnImpl(command, commandArgs, { env: process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true }), JSON.stringify(jevHybridRequest(prompt, JEV_TIER_DESCRIPTIONS)), this.timeoutMs); }
    catch (error) { return fallbackJevClassification(config, `${error.message}，已使用兜底档位`); }
    let parsed;
    try { parsed = JSON.parse(result.stdout.trim()); } catch {}
    if (result.code !== 0 || !parsed?.answers || typeof parsed.answers !== "object") return fallbackJevClassification(config, "Jev 判断失败，已使用兜底档位");
    const decision = resolveJevHybridAnswer(parsed, { tiers: JEV_ROUTE_TIERS, minConfidence: config.minConfidence, fallbackTier: config.fallbackTier });
    return { ...decision, ...config.mappings[decision.tier] };
  }

  async dispatch({ prompt: rawPrompt, cwd }) {
    const prompt = promptText(rawPrompt);
    const config = await this.store.read();
    const classification = await this.classify(prompt, config);
    const task = await this.taskDispatcher.dispatch({ prompt, cwd, model: classification.model, effort: classification.effort });
    return { ...task, classification };
  }
}
