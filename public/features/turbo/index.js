import { requestJson } from "../../core/transport.js";

export function createTurboFeature({ $, showToast }) {
  const button = () => $("[data-turbo-toggle]");

  function render(data = {}) {
    const target = button();
    if (!target) return;
    const enabled = data.enabled === true;
    target.dataset.enabled = enabled ? "true" : "false";
    target.setAttribute("aria-pressed", enabled ? "true" : "false");
    target.disabled = false;
    target.querySelector("[data-turbo-label]").textContent = enabled ? "Turbo 开" : "Turbo";
    const summary = [data.model ? String(data.model).replace(/^gpt-/, "") : "原模型", data.reasoningEffort === "preserve" ? "原强度" : data.reasoningEffort === "maximum" ? "最高推理" : data.reasoningEffort, data.fast ? "Fast" : null, data.millionContext ? "1M" : null].filter(Boolean).join(" · ");
    target.querySelector("[data-turbo-state]").textContent = enabled ? summary : "关闭";
    target.title = enabled ? `Turbo 已开启：${summary}；点击关闭并恢复原设置` : `开启 Turbo：${summary}`;
  }

  async function load({ quiet = false } = {}) {
    try { render(await requestJson("/api/turbo", { cache: "no-store" })); }
    catch (error) { if (!quiet) showToast(`Turbo 状态读取失败：${error.message}`); }
  }

  async function toggle() {
    const target = button();
    if (!target || target.disabled) return;
    const enabled = target.dataset.enabled !== "true";
    target.disabled = true;
    try {
      const result = await requestJson("/api/turbo", { method: "PUT", body: { enabled } });
      render(result);
      const failures = (result.nodes || []).filter((node) => node.status !== "applied").length;
      showToast(failures ? `Turbo 已在可达设备${enabled ? "开启" : "关闭"}，${failures} 台待同步` : `Turbo 已在所有设备${enabled ? "开启" : "关闭"}`);
    } catch (error) {
      target.disabled = false;
      showToast(`Turbo 切换失败：${error.message}`);
    }
  }

  function bind() { button()?.addEventListener("click", () => void toggle()); }
  return { bind, load, render, toggle };
}
