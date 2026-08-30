import { buildProjectPriorities } from "./priority.mjs";

function uniqueDevices(results) {
  const devices = new Map();
  for (const result of results) for (const device of result.devices || []) if (!devices.has(device.id)) devices.set(device.id, device);
  return [...devices.values()];
}

export class FederatedTaskAdapter {
  constructor({ localAdapter, peerAdapters = [] } = {}) {
    this.localAdapter = localAdapter;
    this.peerAdapters = peerAdapters;
  }

  async listTasks() {
    const results = await Promise.all([this.localAdapter.listTasks(), ...this.peerAdapters.map((adapter) => adapter.listTasks())]);
    const tasks = results.flatMap((result) => result.tasks || []).sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
    const failedPeers = results.slice(1).filter((result) => result.status === "error").length;
    let status = tasks.length ? "connected" : results.some((result) => result.status === "empty") ? "empty" : "error";
    if (results[0].status === "disconnected" && !tasks.length) status = "disconnected";
    return {
      status,
      source: "federated-codex-nodes",
      readOnly: true,
      tasks,
      projects: buildProjectPriorities(tasks),
      devices: uniqueDevices(results),
      message: failedPeers ? `${failedPeers} 个远程节点暂时不可达，本机数据仍可使用。` : results[0].message || ""
    };
  }

  async getTask(id) {
    const local = await this.localAdapter.getTask(id);
    if (local) return local;
    const result = await this.listTasks();
    return result.tasks.find((task) => task.id === id) || null;
  }

  async getActivity(id, deviceId) {
    if (deviceId === this.localAdapter.device?.id) return this.localAdapter.getActivity(id);
    const peer = this.peerAdapters.find((adapter) => adapter.peer?.id === deviceId);
    if (!peer) return null;
    return peer.getActivity(id);
  }

  async sendMessage(id, deviceId, prompt, expectedDraftRevision = null) {
    const peer = this.peerAdapters.find((adapter) => adapter.peer?.id === deviceId);
    if (!peer) return null;
    return peer.sendMessage(id, prompt, expectedDraftRevision);
  }
}
