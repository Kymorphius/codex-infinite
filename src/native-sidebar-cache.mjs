export function preserveOfflineProjects(next, previous) {
  const previousById = new Map(previous.map((device) => [device.id, device]));
  return Object.freeze(next.map((device) => {
    const cached = previousById.get(device.id);
    if (device.status !== "offline" || device.conversationCount || !cached?.conversationCount) return device;
    return Object.freeze({
      ...device,
      projectCount: cached.projectCount,
      conversationCount: cached.conversationCount,
      hiddenProjectCount: cached.hiddenProjectCount,
      projects: cached.projects
    });
  }));
}
