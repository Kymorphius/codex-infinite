import { normalizeSidebarAction, normalizeSidebarSnapshot, sidebarError } from './sidebar-contract.mjs';

export class SidebarFederationService {
  constructor({ localAdapter, localDevice, peers = [], clock = Date.now, cacheMs = 5000 } = {}) {
    Object.assign(this, { localAdapter, localDevice, peers, clock, cacheMs });
    this.generations = new Map(); this.cache = new Map(); this.pending = new Map(); this.nextReads = new Map();
  }
  sources() {
    return [{ device: { ...this.localDevice, kind: 'local-codex' }, adapter: this.localAdapter },
      ...this.peers.map(({ peer, sidebar }) => ({ device: { id: peer.id, name: peer.name, kind: 'remote-codex' }, adapter: sidebar }))];
  }
  refresh(source) {
    const id = source.device.id;
    if (this.pending.has(id)) return this.pending.get(id);
    const generation = this.generations.get(id) || 0;
    const current = () => generation === (this.generations.get(id) || 0);
    const pending = Promise.resolve().then(() => source.adapter.read()).then(snapshot => {
      if (!current()) return;
      this.cache.set(id, { device: source.device, status: 'connected', snapshot: normalizeSidebarSnapshot(snapshot), message: null });
    }).catch(error => {
      if (!current()) return;
      this.cache.set(id, { device: source.device, status: 'offline', snapshot: this.cache.get(id)?.snapshot || null,
        message: error.statusCode ? error.message : '设备离线或原生侧边栏未就绪' });
    }).finally(() => { this.pending.delete(id); this.nextReads.set(id, this.clock() + this.cacheMs); });
    this.pending.set(id, pending); return pending;
  }
  async read() {
    const sources = this.sources();
    for (const source of sources) if (this.clock() >= (this.nextReads.get(source.device.id) || 0)) void this.refresh(source);
    if (!this.cache.has(this.localDevice.id)) await this.pending.get(this.localDevice.id);
    return { schemaVersion: 1, devices: sources.map(source => this.cache.get(source.device.id)
      || { device: source.device, status: 'loading', snapshot: null, message: '正在读取原生侧边栏' }) };
  }
  async apply(input = {}) {
    const source = this.sources().find(source => source.device.id === input.deviceId);
    if (!source) throw sidebarError('未知侧边栏所属设备', 404);
    const action = normalizeSidebarAction(input);
    await this.pending.get(source.device.id);
    const id = source.device.id;
    this.generations.set(id, (this.generations.get(id) || 0) + 1);
    let result;
    try { result = await source.adapter.apply(action); }
    finally { this.generations.set(id, (this.generations.get(id) || 0) + 1); }
    if (!result?.applied || !result?.snapshot) throw sidebarError('所属设备未确认侧边栏修改', 409);
    this.cache.set(source.device.id, { device: source.device, status: 'connected', snapshot: normalizeSidebarSnapshot(result.snapshot), message: null });
    this.nextReads.set(source.device.id, this.clock() + this.cacheMs);
    return { ...result, deviceId: source.device.id };
  }
}
