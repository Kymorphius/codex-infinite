const MAX_DEVICES = 8, MAX_PROJECTS_PER_DEVICE = 64, MAX_CONVERSATIONS_PER_PROJECT = 6;
function text(value, maxLength) { return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength); }
function status(value) { return ["connected", "empty"].includes(String(value || "").toLowerCase()) ? "connected" : "offline"; }

export function normalizeNativeRemoteSidebarItems(items = []) {
  const devices = [];
  for (const item of Array.isArray(items) ? items.slice(0, MAX_DEVICES) : []) {
    const id = text(item?.id, 120), name = text(item?.name, 80);
    if (!id || !name) continue;
    const projects = [];
    for (const project of Array.isArray(item?.projects) ? item.projects.slice(0, MAX_PROJECTS_PER_DEVICE) : []) {
      const key = text(project?.key, 200), projectName = text(project?.name, 100);
      if (!key || !projectName) continue;
      const conversations = [];
      for (const conversation of Array.isArray(project?.conversations) ? project.conversations.slice(0, MAX_CONVERSATIONS_PER_PROJECT) : []) {
        const conversationId = text(conversation?.id, 160);
        if (!conversationId) continue;
        conversations.push(Object.freeze({ id: conversationId, title: text(conversation?.title, 160) || "未命名会话", status: text(conversation?.status, 32) || "unknown", updatedAt: text(conversation?.updatedAt, 64) || null }));
      }
      projects.push(Object.freeze({ key, name: projectName, sourceDirectory: text(project?.sourceDirectory, 1024) || null, sourceDirectories: Object.freeze([...new Set((Array.isArray(project?.sourceDirectories) ? project.sourceDirectories : [project?.sourceDirectory]).slice(0, 64).map(value => text(value, 1024)).filter(Boolean))]), conversationCount: Math.max(conversations.length, Number(project?.conversationCount) || 0), hiddenConversationCount: Math.max(0, Number(project?.hiddenConversationCount) || 0), conversations: Object.freeze(conversations) }));
    }
    devices.push(Object.freeze({ id, name, kind: "remote-codex", status: status(item?.status), projectCount: Math.max(projects.length, Number(item?.projectCount) || 0), conversationCount: Math.max(0, Number(item?.conversationCount) || 0), hiddenProjectCount: Math.max(0, Number(item?.hiddenProjectCount) || 0), projects: Object.freeze(projects) }));
  }
  return Object.freeze(devices);
}
export function buildNativeRemoteSidebarSnapshotScript(items = []) {
  return `window.__codexControlConsoleSetRemoteSidebar?.(${JSON.stringify(normalizeNativeRemoteSidebarItems(items))})`;
}
