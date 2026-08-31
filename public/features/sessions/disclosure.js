export function summarizeSessionDevice(device = {}) {
  const tasks = Array.isArray(device.tasks) ? device.tasks : [];
  const projects = Array.isArray(device.projects) ? device.projects : [];
  return Object.freeze({
    projectCount: projects.length,
    sessionCount: tasks.length,
    activeCount: tasks.filter((task) => task.status === "active").length,
    latestAt: device.latestAt || tasks.reduce((latest, task) => String(task.updatedAt || "") > latest ? String(task.updatedAt || "") : latest, "")
  });
}

function projectKey(deviceId, directoryKey) {
  return `${deviceId}\n${directoryKey}`;
}

export class SessionDisclosureState {
  constructor() {
    this.collapsedDevices = new Set();
    this.projectChoices = new Map();
  }

  isFiltering(filter) {
    return Boolean(filter?.query) || (filter?.status && filter.status !== "all");
  }

  isDeviceOpen(deviceId, filter) {
    return this.isFiltering(filter) || !this.collapsedDevices.has(deviceId);
  }

  setDeviceOpen(deviceId, open) {
    if (open) this.collapsedDevices.delete(deviceId);
    else this.collapsedDevices.add(deviceId);
  }

  isProjectOpen(deviceId, directoryKey, defaultOpen, filter) {
    if (this.isFiltering(filter)) return true;
    return this.projectChoices.get(projectKey(deviceId, directoryKey)) ?? defaultOpen;
  }

  setProjectOpen(deviceId, directoryKey, open) {
    this.projectChoices.set(projectKey(deviceId, directoryKey), Boolean(open));
  }

  setAll(devices, open) {
    for (const device of devices) {
      this.setDeviceOpen(device.id, open);
      for (const project of device.projects || []) this.setProjectOpen(device.id, project.key, open);
    }
  }
}
