function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

async function jsonRequest(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
  const body = await response.json();
  if (!response.ok || body.status !== "ok") throw new Error(body.message || "项目复制请求失败");
  return body;
}

export function createProjectCopyControl({ fetchImpl = fetch, promptImpl = window.prompt, confirmImpl = window.confirm, alertImpl = window.alert } = {}) {
  async function copy(device, group, button) {
    button.disabled = true;
    const original = button.textContent;
    try {
      button.textContent = "读取目录…";
      const options = await jsonRequest(fetchImpl, "/api/project-copy/options");
      const root = options.destinationRoots?.[0];
      if (!root) throw new Error("本机没有配置可复制到的目录");
      const separator = root.includes("\\") ? "\\" : "/";
      const suggested = `${root.replace(/[\\/]$/, "")}${separator}${group.project}`;
      const destinationDirectory = promptImpl(`把“${group.project}”复制到本机目录：`, suggested);
      if (!destinationDirectory) return;
      const selection = { deviceId: device.id, sourceDirectory: group.directory, destinationDirectory };
      button.textContent = "正在预检…";
      const preflight = await jsonRequest(fetchImpl, "/api/project-copy/preflight", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(selection)
      });
      const excluded = preflight.excluded?.length ? `\n不复制可再生成目录：${preflight.excluded.join("、")}` : "";
      const existing = preflight.existingDestination ? "\n目标项目文件已存在且校验一致，本次只补充会话。" : "";
      const accepted = confirmImpl(`准备复制 ${preflight.fileCount} 个项目文件（${formatBytes(preflight.bytes)}）和 ${preflight.conversationCount || 0} 个会话（${formatBytes(preflight.conversationBytes)}）到：\n${preflight.destinationDirectory}${excluded}${existing}\n\n源项目和远端会话不会改变；本机会话将使用新的 ID。现在开始吗？`);
      if (!accepted) return;
      button.textContent = "正在复制…";
      const result = await jsonRequest(fetchImpl, "/api/project-copy/execute", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...selection, preflightToken: preflight.token })
      });
      alertImpl(`项目与会话已复制并校验完成：\n${result.destinationDirectory}\n${result.fileCount} 个文件，${result.conversationCount || 0} 个本机会话`);
    } catch (error) {
      alertImpl(error.message || "项目复制失败");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function button(device, group) {
    if (device.kind === "local-codex" || device.status !== "connected" || !group.directory) return null;
    const element = document.createElement("button");
    element.type = "button";
    element.className = "session-project-copy";
    element.textContent = "复制项目";
    element.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); void copy(device, group, element); });
    return element;
  }

  return { button, copy };
}
