export function groupToggleRequests(group, deviceId, enabled) {
  return (group?.skills || []).filter((skill) => (skill.enabled !== false) !== enabled).map((skill) => ({
    sourceDeviceId: deviceId,
    scope: skill.scope,
    sourceId: skill.sourceId,
    name: skill.name,
    enabled
  }));
}

export function groupSyncRequests(group, deviceId, targetDeviceIds) {
  return (group?.skills || []).map((skill) => ({
    sourceDeviceId: deviceId,
    scope: skill.scope,
    sourceId: skill.sourceId,
    name: skill.name,
    sourceHash: skill.hash,
    targetDeviceIds
  }));
}

export async function runGroupRequests(requests, execute) {
  const results = [];
  for (const request of requests) {
    try { results.push({ name: request.name, status: "ok", value: await execute(request) }); }
    catch (error) { results.push({ name: request.name, status: "error", message: error.message }); }
  }
  return {
    total: requests.length,
    succeeded: results.filter((result) => result.status === "ok").length,
    failed: results.filter((result) => result.status === "error").length,
    results
  };
}

export function syncResultHasFailures(result) {
  return result?.converged === false || (result?.results || []).some((item) => item.status === "error");
}

export function createGroupControls({ documentRef, group, entry, devices }) {
  const controls = documentRef.createElement("div");
  controls.className = "skill-group-controls";
  controls.dataset.skillGroupControl = "true";
  controls.addEventListener("click", (event) => event.stopPropagation());
  controls.addEventListener("keydown", (event) => event.stopPropagation());

  const toggle = documentRef.createElement("label");
  toggle.className = "skill-toggle skill-group-toggle";
  const input = documentRef.createElement("input");
  input.type = "checkbox";
  input.checked = group.enabledCount === group.total;
  input.indeterminate = group.enabledCount > 0 && group.enabledCount < group.total;
  input.dataset.skillGroupToggle = "true";
  input.dataset.deviceId = entry.device.id;
  input.dataset.groupKey = group.key;
  input.setAttribute("aria-label", `${group.label}整组启用状态`);
  const toggleText = documentRef.createElement("span");
  toggleText.textContent = "整组启用";
  toggle.append(input, toggleText);

  const button = documentRef.createElement("button");
  button.type = "button";
  button.className = "quiet-button small-button skill-group-sync";
  button.textContent = "共享全部";
  button.dataset.skillGroupSync = "true";
  button.dataset.deviceId = entry.device.id;
  button.dataset.groupKey = group.key;
  button.disabled = !devices.some((device) => device.status === "connected" && device.device?.id !== entry.device.id);
  button.setAttribute("aria-label", `${group.label}共享全部 Skill`);
  controls.append(toggle, button);
  return controls;
}
