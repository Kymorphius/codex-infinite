import { requestJson } from "../../core/transport.js";

export const JEV_TIERS = Object.freeze([
  { id: "instant", label: "即时", description: "极小、确定性任务" },
  { id: "quick", label: "轻快", description: "机械、低风险" },
  { id: "everyday", label: "日常", description: "边界清晰的开发与分析" },
  { id: "substantial", label: "进阶", description: "多文件与多依赖" },
  { id: "complex", label: "复杂", description: "跨模块或研究型" },
  { id: "deep", label: "深度", description: "困难系统问题" },
  { id: "critical", label: "关键", description: "高风险架构或迁移" },
  { id: "extreme", label: "极限", description: "极高风险或高度模糊" }
]);
export const JEV_MODELS = Object.freeze(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"]);
export const JEV_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]);

function modelLabel(model) {
  return ({ "gpt-5.6-luna": "GPT-5.6 Luna", "gpt-5.6-terra": "GPT-5.6 Terra", "gpt-5.6-sol": "GPT-5.6 Sol", "gpt-6-astra": "GPT-6 Astra" })[model] || model;
}

export function createJevRoutingFeature({ $, showToast }) {
  const panel = $('[data-module-panel="jev-routing"]');
  const configForm = $('[data-testid="jev-config-form"]');
  const dispatchForm = $('[data-testid="jev-dispatch-form"]');
  const mappings = $('[data-jev-mappings]');
  const result = $('[data-testid="jev-result"]');

  function mappingRow(tier) {
    const row = document.createElement("div");
    row.className = "jev-mapping-row";
    row.dataset.jevTier = tier.id;
    const title = document.createElement("div");
    title.className = "jev-tier";
    title.innerHTML = `<strong>${tier.label}</strong><small>${tier.id} · ${tier.description}</small>`;
    const model = document.createElement("label");
    model.className = "field";
    model.innerHTML = `<span>模型</span><select name="${tier.id}.model">${JEV_MODELS.map((id) => `<option value="${id}">${modelLabel(id)}</option>`).join("")}</select>`;
    const effort = document.createElement("label");
    effort.className = "field";
    effort.innerHTML = `<span>推理强度</span><select name="${tier.id}.effort">${JEV_EFFORTS.map((id) => `<option value="${id}">${id}</option>`).join("")}</select>`;
    row.append(title, model, effort);
    return row;
  }

  function ensureFields() {
    if (mappings.children.length) return;
    mappings.append(...JEV_TIERS.map(mappingRow));
    configForm.elements.fallbackTier.append(...JEV_TIERS.map((tier) => new Option(`${tier.label} · ${tier.id}`, tier.id)));
  }

  function applyConfig(config) {
    for (const tier of JEV_TIERS) {
      configForm.elements[`${tier.id}.model`].value = config.mappings[tier.id].model;
      configForm.elements[`${tier.id}.effort`].value = config.mappings[tier.id].effort;
    }
    configForm.elements.minConfidence.value = String(config.minConfidence);
    configForm.elements.fallbackTier.value = config.fallbackTier;
  }

  function readConfig() {
    return {
      version: 2,
      minConfidence: Number(configForm.elements.minConfidence.value),
      fallbackTier: configForm.elements.fallbackTier.value,
      mappings: Object.fromEntries(JEV_TIERS.map((tier) => [tier.id, {
        model: configForm.elements[`${tier.id}.model`].value,
        effort: configForm.elements[`${tier.id}.effort`].value
      }]))
    };
  }

  function syncEfforts() {
    for (const tier of JEV_TIERS) {
      const model = configForm.elements[`${tier.id}.model`];
      const effort = configForm.elements[`${tier.id}.effort`];
      const ultra = [...effort.options].find((option) => option.value === "ultra");
      ultra.disabled = model.value === "gpt-5.6-luna";
      if (ultra.disabled && effort.value === "ultra") effort.value = "max";
    }
  }

  async function load() {
    ensureFields();
    try {
      const data = await requestJson("/api/jev-routing", { cache: "no-store" });
      applyConfig(data.config);
      syncEfforts();
      $('[data-jev-availability]').textContent = data.available ? "Jev 已连接" : "Jev 不可用，将使用兜底档位";
    } catch (error) { showToast(error.message); }
  }

  async function save(event) {
    event.preventDefault();
    const button = configForm.querySelector("[data-jev-save]");
    button.disabled = true;
    try {
      const data = await requestJson("/api/jev-routing", { method: "PUT", body: readConfig() });
      applyConfig(data.config);
      syncEfforts();
      showToast("自动分流映射已保存，两边共用。");
    } catch (error) { showToast(error.message); }
    finally { button.disabled = false; }
  }

  async function dispatch(event) {
    event.preventDefault();
    const button = dispatchForm.querySelector("[data-jev-dispatch]");
    button.disabled = true;
    button.textContent = "正在判断并创建…";
    try {
      const input = Object.fromEntries(new FormData(dispatchForm));
      const data = await requestJson("/api/jev-routing/dispatch", { method: "POST", body: input });
      const { classification, threadId, model, effort } = data.result;
      result.dataset.fallback = String(classification.fallback);
      result.replaceChildren();
      const title = document.createElement("strong");
      title.textContent = `${classification.tier} → ${modelLabel(model)} · ${effort}`;
      const detail = document.createElement("span");
      detail.textContent = `${classification.reason} · 任务 ${threadId}`;
      result.append(title, detail);
      result.classList.remove("hidden");
      showToast("原生 Codex 任务已创建。");
    } catch (error) { showToast(error.message); }
    finally { button.disabled = false; button.textContent = "判断并创建任务"; }
  }

  function bind() {
    ensureFields();
    configForm.addEventListener("change", syncEfforts);
    configForm.addEventListener("submit", save);
    dispatchForm.addEventListener("submit", dispatch);
  }

  return { bind, load };
}
