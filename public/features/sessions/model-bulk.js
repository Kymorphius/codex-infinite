const NATIVE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function planModelReplacement(tasks, catalogs, source, target) {
  const matching = tasks.filter((task) => task.provider !== 'terminal' && task.model === source);
  const eligible = matching.filter((task) => (
    NATIVE_ID.test(task.id)
    && task.device?.id
    && task.device.status === "connected"
    && catalogs.get(task.device.id)?.some((model) => model.id === target)
  ));
  return { matching, eligible, skipped: matching.length - eligible.length };
}

export function createModelBulkControl({ state, $, fetchImpl = fetch, onChanged = () => {} }) {
  const details = $('[data-testid="session-model-bulk"]');
  const source = $('[data-testid="session-bulk-source"]');
  const target = $('[data-testid="session-bulk-target"]');
  const preview = $('[data-testid="session-bulk-preview"]');
  const apply = $('[data-testid="session-bulk-apply"]');
  const result = $('[data-testid="session-bulk-result"]');
  const catalogs = new Map();
  const attempted = new Set();
  let pending = false;
  let loading = false;

  function setOptions(select, entries, prior) {
    select.replaceChildren(...entries.map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }));
    if (entries.some(([value]) => value === prior)) select.value = prior;
  }

  function render() {
    if (!details.open || pending) return;
    if (!loading && state.taskStatus === "connected" && state.tasks.some((task) => task.device?.id && !attempted.has(task.device.id))) {
      queueMicrotask(() => { void loadCatalogs(); });
    }
    const sourceModels = [...new Set(state.tasks.filter(task => task.provider !== 'terminal').map((task) => task.model).filter(Boolean))].sort();
    setOptions(source, sourceModels.map((model) => [model, model]), source.value || "gpt-5.6-sol");
    const models = [...new Map([...catalogs.values()].flat().map((model) => [model.id, model])).values()]
      .filter((model) => model.id !== source.value).sort((a, b) => a.id.localeCompare(b.id));
    setOptions(target, models.map((model) => [model.id, `${model.displayName || model.id} (${model.id})`]), target.value || "gpt-6-sol");
    const plan = planModelReplacement(state.tasks, catalogs, source.value, target.value);
    const deviceCount = new Set(plan.eligible.map((task) => task.device.id)).size;
    preview.textContent = loading ? "正在读取各设备可用模型…" : !source.value ? "没有已记录模型的会话" : !target.value
      ? "所属设备没有提供可选的新模型" : `当前索引命中 ${plan.matching.length} 个会话；可更换 ${plan.eligible.length} 个，跳过 ${plan.skipped} 个；涉及 ${deviceCount} 台设备。`;
    apply.disabled = loading || !target.value || !plan.eligible.length;
    apply.textContent = plan.eligible.length ? `更换 ${plan.eligible.length} 个会话` : "没有可更换的会话";
  }

  async function loadCatalogs() {
    if (loading) return;
    loading = true;
    render();
    try {
      const devices = [...new Set(state.tasks.map((task) => task.device?.id).filter(Boolean))];
      await Promise.all(devices.map(async (deviceId) => {
        attempted.add(deviceId);
        if (catalogs.has(deviceId)) return;
        const candidates = state.tasks.filter((task) => task.provider !== 'terminal' && task.device?.id === deviceId && NATIVE_ID.test(task.id)).slice(0, 3);
        for (const task of candidates) {
          try {
            const response = await fetchImpl(`/api/tasks/${encodeURIComponent(task.id)}/activity?device=${encodeURIComponent(deviceId)}`, { cache: "no-store" });
            if (!response.ok) continue;
            const data = await response.json();
            const models = (data.activity || data).settingsOptions?.models;
            if (Array.isArray(models)) { catalogs.set(deviceId, models); break; }
          } catch { /* Another conversation on this device may still be readable. */ }
        }
      }));
    } finally {
      loading = false;
      render();
    }
  }

  async function replace() {
    if (pending || loading) return;
    const oldModel = source.value;
    const newModel = target.value;
    const plan = planModelReplacement(state.tasks, catalogs, oldModel, newModel);
    if (!plan.eligible.length) return;
    pending = true;
    apply.disabled = true;
    let accepted = 0;
    const failures = [];
    for (const [index, task] of plan.eligible.entries()) {
      result.textContent = `正在更换 ${index + 1}/${plan.eligible.length}：已接收 ${accepted}，失败 ${failures.length}。`;
      try {
        const url = `/api/tasks/${encodeURIComponent(task.id)}/settings?device=${encodeURIComponent(task.device.id)}`;
        const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes: { model: newModel }, expectedModel: oldModel }) });
        const data = await response.json();
        if (!response.ok || !data.accepted || data.duplicate || data.settings?.model !== newModel) throw new Error(data.message || "所属设备没有确认模型变更");
        accepted += 1;
        state.tasks = state.tasks.map((item) => item.id === task.id && item.device?.id === task.device.id ? { ...item, model: newModel, reasoningEffort: data.settings.reasoningEffort } : item);
      } catch (error) { failures.push(`${task.title || task.id}: ${error.message}`); }
    }
    pending = false;
    onChanged();
    render();
    result.textContent = `已接收 ${accepted} 个会话的模型更换请求；失败 ${failures.length} 个，跳过 ${plan.skipped} 个。${failures.length ? `失败：${failures.slice(0, 3).join("；")}${failures.length > 3 ? "；其余请稍后重试" : ""}` : "下一轮起生效。"}`;
  }

  function bind() {
    details.addEventListener("toggle", () => { if (details.open) void loadCatalogs(); });
    source.addEventListener("change", () => { result.textContent = ""; render(); });
    target.addEventListener("change", () => { result.textContent = ""; render(); });
    apply.addEventListener("click", () => { void replace(); });
  }

  return { bind, render };
}
