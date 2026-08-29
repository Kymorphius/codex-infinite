export function normalizeTaskPayload(data = {}) {
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const projects = Array.isArray(data.projects) ? data.projects : [];
  const devices = Array.isArray(data.devices) ? data.devices : [];
  let status = "error";
  let message = data.message || "任务数据不可用。";
  if (data.status === "connected" && tasks.length) {
    status = "connected";
    message = "";
  } else if (data.status === "empty") status = "empty";
  else if (data.status === "disconnected") status = "disconnected";
  return { tasks, projects, devices, status, message };
}

export function taskStatePresentation(status, message = "") {
  const label = { connected: "已连接", empty: "暂无任务", disconnected: "未连接", error: "读取失败", loading: "连接中…" }[status];
  const source = status === "connected" ? "本机记录" : status === "loading" ? "读取中" : "不可用";
  return { status, label, source, message };
}

export function createTaskSource({ state, onState, onData, fetchImpl = fetch }) {
  async function load() {
    onState(taskStatePresentation("loading"));
    try {
      const response = await fetchImpl("/api/tasks", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = normalizeTaskPayload(await response.json());
      state.tasks = result.tasks;
      state.projects = result.projects;
      state.devices = result.devices;
      onData(result);
      onState(taskStatePresentation(result.status, result.message));
    } catch (error) {
      onState(taskStatePresentation("disconnected", `无法连接到控制台服务：${error.message}`));
    }
  }

  return { load };
}
