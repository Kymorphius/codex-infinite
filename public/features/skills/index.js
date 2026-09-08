import { requestJson } from "../../core/transport.js";
import { createGroupControls, groupSyncRequests, groupToggleRequests, runGroupRequests, syncResultHasFailures } from "./group-actions.js";

function bytes(value) {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
}

export function groupSkills(skills = []) {
  const groups = new Map();
  for (const skill of skills) {
    const project = skill.scope === "repo";
    const projectName = String(skill.projectName || "未命名项目");
    const key = project ? `project:${projectName}` : "personal";
    if (!groups.has(key)) groups.set(key, { key, kind: project ? "project" : "personal", label: project ? `项目 · ${projectName}` : "个人技能", skills: [] });
    groups.get(key).skills.push(skill);
  }
  return [...groups.values()].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "personal" ? -1 : 1;
    return left.label.localeCompare(right.label, "zh-CN");
  }).map((group) => ({ ...group, total: group.skills.length, enabledCount: group.skills.filter((skill) => skill.enabled !== false).length }));
}

export function createSkillsFeature({ $, showToast, documentRef = document, confirmSync = (message) => window.confirm(message) }) {
  let snapshot = null;
  let loading = false;

  function setState(name, message = "") {
    for (const state of documentRef.querySelectorAll("[data-skills-state]")) state.classList.toggle("hidden", state.dataset.skillsState !== name);
    $("[data-testid='skills-device-list']")?.classList.toggle("hidden", name !== "ready");
    if (message && $("[data-skills-error]")) $("[data-skills-error]").textContent = message;
  }

  function synchronizedCount(devices) {
    const copies = new Map();
    for (const entry of devices) for (const skill of entry.skills || []) {
      if (skill.scope === "repo") continue;
      const key = `${skill.scope}:${skill.name}`;
      if (!copies.has(key)) copies.set(key, []);
      copies.get(key).push(skill.hash);
    }
    return [...copies.values()].filter((hashes) => hashes.length > 1 && new Set(hashes).size === 1).length;
  }

  function resolveGroup(control) {
    const entry = (snapshot?.devices || []).find((device) => device.device?.id === control.dataset.deviceId);
    const group = groupSkills(entry?.skills || []).find((candidate) => candidate.key === control.dataset.groupKey);
    return { entry, group };
  }

  function targetsFor(deviceId) {
    return (snapshot?.devices || []).filter((entry) => entry.status === "connected" && entry.device?.id !== deviceId).map((entry) => entry.device);
  }

  function createSkillRow(skill, entry, devices) {
    const row = documentRef.createElement("div");
    row.className = `skill-row${skill.enabled === false ? " is-disabled" : ""}`;
    const targetScope = skill.scope === "repo" ? "agents-user" : skill.scope;
    const copyHashes = devices.filter((device) => device.status === "connected").map((device) => device.skills?.find((candidate) => candidate.scope === targetScope && candidate.name === skill.name)?.hash).filter(Boolean);
    if (skill.scope === "repo") copyHashes.push(skill.hash);
    const info = documentRef.createElement("div");
    info.className = "skill-info";
    const name = documentRef.createElement("strong");
    name.textContent = skill.declaredName || skill.name;
    const description = documentRef.createElement("p");
    description.textContent = skill.description || "没有说明";
    const meta = documentRef.createElement("small");
    const scopeLabel = skill.scope === "repo" ? "项目专用" : skill.scope === "agents-user" ? "通用个人" : "Codex 个人";
    meta.textContent = `${scopeLabel}${skill.enabled === false ? " · 已停用" : " · 已启用"}${skill.linked ? " · 链接来源" : ""} · ${skill.fileCount} 个文件 · ${bytes(skill.totalBytes)} · ${skill.hash.slice(0, 10)}`;
    info.append(name, description, meta);
    const actions = documentRef.createElement("div");
    actions.className = "skill-actions";
    const badge = documentRef.createElement("span");
    badge.className = `skill-sync-badge ${copyHashes.length > 1 && new Set(copyHashes).size === 1 ? "is-synced" : ""}`;
    badge.textContent = copyHashes.length > 1 && new Set(copyHashes).size === 1 ? "已同步" : copyHashes.length > 1 ? "有差异" : skill.scope === "repo" ? "项目专用" : "仅此设备";
    const toggle = documentRef.createElement("label");
    toggle.className = "skill-toggle";
    const toggleInput = documentRef.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.checked = skill.enabled !== false;
    toggleInput.dataset.skillToggle = "true";
    toggleInput.dataset.deviceId = entry.device.id;
    toggleInput.dataset.scope = skill.scope;
    toggleInput.dataset.sourceId = skill.sourceId;
    toggleInput.dataset.skillName = skill.name;
    toggleInput.setAttribute("aria-label", `${skill.declaredName || skill.name} 启用状态`);
    const toggleText = documentRef.createElement("span");
    toggleText.textContent = skill.enabled === false ? "停用" : "启用";
    toggle.append(toggleInput, toggleText);
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = "primary-button small-button";
    button.textContent = skill.scope === "repo" ? "共享为个人技能" : "同步到其他设备";
    button.dataset.skillSync = "true";
    button.dataset.deviceId = entry.device.id;
    button.dataset.scope = skill.scope;
    button.dataset.sourceId = skill.sourceId;
    button.dataset.skillName = skill.name;
    button.dataset.hash = skill.hash;
    button.disabled = devices.filter((device) => device.status === "connected" && device.device?.id !== entry.device.id).length === 0;
    actions.append(badge, toggle, button);
    row.append(info, actions);
    return row;
  }

  function render(data) {
    snapshot = data;
    const devices = data.devices || [];
    const allSkills = devices.flatMap((entry) => entry.skills || []);
    $("[data-testid='skills-device-count']").textContent = String(devices.length);
    $("[data-testid='skills-count']").textContent = String(allSkills.length);
    $("[data-testid='skills-synced-count']").textContent = String(synchronizedCount(devices));
    $("[data-testid='skills-status']").textContent = devices.some((entry) => entry.status === "error") ? "部分设备不可达" : "已连接";
    if (!allSkills.length && !devices.some((entry) => entry.status === "error")) return setState("empty");
    const list = $("[data-testid='skills-device-list']");
    list.replaceChildren(...devices.map((entry) => {
      const card = documentRef.createElement("article");
      card.className = "skills-device-card";
      const heading = documentRef.createElement("header");
      heading.className = "skills-device-heading";
      const identity = documentRef.createElement("div");
      const title = documentRef.createElement("h3");
      title.textContent = entry.device?.name || entry.device?.id || "未知设备";
      const location = documentRef.createElement("small");
      location.textContent = entry.device?.location || entry.device?.id || "本机";
      identity.append(title, location);
      const status = documentRef.createElement("span");
      status.className = `skills-device-status ${entry.status === "connected" ? "is-connected" : "is-error"}`;
      status.textContent = entry.status === "connected" ? `${entry.skills?.length || 0} 个 Skill` : "不可达";
      heading.append(identity, status);
      card.append(heading);
      if (entry.status !== "connected") {
        const message = documentRef.createElement("p");
        message.className = "skills-device-message";
        message.textContent = entry.message || "暂时无法读取这台设备。";
        card.append(message);
        return card;
      }
      const skills = documentRef.createElement("div");
      skills.className = "skill-groups";
      for (const group of groupSkills(entry.skills || [])) {
        const section = documentRef.createElement("details");
        section.className = `skill-group is-${group.kind}`;
        section.open = group.kind === "personal" || group.total === 1;
        section.dataset.skillGroup = group.key;
        const summary = documentRef.createElement("summary");
        summary.className = "skill-group-heading";
        const label = documentRef.createElement("strong");
        label.textContent = group.label;
        const counts = documentRef.createElement("span");
        counts.className = "skill-group-counts";
        counts.textContent = `${group.total} 个 · ${group.enabledCount} 个启用`;
        summary.append(label, counts, createGroupControls({ documentRef, group, entry, devices }));
        const rows = documentRef.createElement("div");
        rows.className = "skills-list";
        rows.append(...group.skills.map((skill) => createSkillRow(skill, entry, devices)));
        section.append(summary, rows);
        skills.append(section);
      }
      if (!entry.skills?.length) {
        const empty = documentRef.createElement("p");
        empty.className = "skills-device-message";
        empty.textContent = "这台设备还没有发现可共享的 Skill。";
        skills.append(empty);
      }
      card.append(skills);
      return card;
    }));
    setState("ready");
  }

  async function load({ quiet = false } = {}) {
    if (loading) return;
    loading = true;
    if (!quiet) setState("loading");
    try { render(await requestJson("/api/skills", { cache: "no-store" })); }
    catch (error) { setState("error", error.message); if (!quiet) showToast(`技能读取失败：${error.message}`); }
    finally { loading = false; }
  }

  async function sync(button) {
    const targets = targetsFor(button.dataset.deviceId);
    if (!targets.length) return showToast("没有可达的目标设备");
    const targetNames = targets.map((device) => device.name || device.id).join("、");
    const action = button.dataset.scope === "repo" ? "共享为通用个人 Skill" : "同步";
    if (!confirmSync(`把 ${button.dataset.skillName} ${action}到 ${targetNames}？目标上的不同版本会先备份再替换。`)) return;
    button.disabled = true;
    try {
      const result = await requestJson("/api/skills/sync", { method: "POST", body: { sourceDeviceId: button.dataset.deviceId, scope: button.dataset.scope, sourceId: button.dataset.sourceId, name: button.dataset.skillName, sourceHash: button.dataset.hash, targetDeviceIds: targets.map((device) => device.id) } });
      const failures = result.results.filter((item) => item.status === "error");
      showToast(failures.length ? `Skill 已同步到部分设备，${failures.length} 台失败` : "Skill 已同步到所有可达设备");
      await load({ quiet: true });
    } catch (error) { showToast(`技能同步失败：${error.message}`); }
    finally { button.disabled = false; }
  }

  async function toggle(input) {
    input.disabled = true;
    try {
      await requestJson("/api/skills/toggle", { method: "POST", body: { sourceDeviceId: input.dataset.deviceId, scope: input.dataset.scope, sourceId: input.dataset.sourceId, name: input.dataset.skillName, enabled: input.checked } });
      showToast(`Skill 已${input.checked ? "启用" : "停用"}，重启该设备上的 Codex 后生效`);
      await load({ quiet: true });
    } catch (error) {
      input.checked = !input.checked;
      showToast(`Skill 开关失败：${error.message}`);
    } finally { input.disabled = false; }
  }

  async function toggleGroup(input) {
    const { group } = resolveGroup(input);
    if (!group) return showToast("技能分组已变化，请刷新后重试");
    const enabled = input.checked;
    const requests = groupToggleRequests(group, input.dataset.deviceId, enabled);
    if (!requests.length) return showToast(`整组已经${enabled ? "启用" : "停用"}`);
    input.disabled = true;
    const result = await runGroupRequests(requests, (body) => requestJson("/api/skills/toggle", { method: "POST", body }));
    showToast(result.failed ? `整组已处理：${result.succeeded} 个成功，${result.failed} 个失败` : `已${enabled ? "启用" : "停用"}整组 ${result.succeeded} 个 Skill，重启该设备上的 Codex 后生效`);
    await load({ quiet: true });
    input.disabled = false;
  }

  async function syncGroup(button) {
    const { group } = resolveGroup(button);
    if (!group) return showToast("技能分组已变化，请刷新后重试");
    const targets = targetsFor(button.dataset.deviceId);
    if (!targets.length) return showToast("没有可达的目标设备");
    const targetNames = targets.map((device) => device.name || device.id).join("、");
    const scopeNote = group.kind === "project" ? "；项目 Skill 会共享为通用个人 Skill" : "";
    if (!confirmSync(`把 ${group.label} 的 ${group.total} 个 Skill 共享到 ${targetNames}${scopeNote}？目标上的不同版本会先备份再替换。`)) return;
    button.disabled = true;
    const requests = groupSyncRequests(group, button.dataset.deviceId, targets.map((device) => device.id));
    const result = await runGroupRequests(requests, async (body) => {
      const response = await requestJson("/api/skills/sync", { method: "POST", body });
      if (syncResultHasFailures(response)) throw new Error("部分目标设备同步失败");
      return response;
    });
    showToast(result.failed ? `整组共享完成：${result.succeeded} 个 Skill 全部成功，${result.failed} 个存在目标失败` : `已共享整组 ${result.succeeded} 个 Skill 到所有可达设备`);
    await load({ quiet: true });
    button.disabled = false;
  }

  function bind() {
    documentRef.addEventListener("click", (event) => {
      const groupButton = event.target.closest("[data-skill-group-sync]");
      if (groupButton) return void syncGroup(groupButton);
      const button = event.target.closest("[data-skill-sync]");
      if (button) void sync(button);
      if (event.target.closest("[data-action='skills-refresh']")) void load();
    });
    documentRef.addEventListener("change", (event) => {
      const groupInput = event.target.closest("[data-skill-group-toggle]");
      if (groupInput) return void toggleGroup(groupInput);
      const input = event.target.closest("[data-skill-toggle]");
      if (input) void toggle(input);
    });
  }
  return { bind, load, render, sync, toggle, syncGroup, toggleGroup };
}
