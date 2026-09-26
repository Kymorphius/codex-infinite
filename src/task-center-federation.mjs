import { normalizeTaskCenterAction, taskCenterError, taskKey, taskProvider } from './task-center-contract.mjs';

function snapshotFor(value, device) {
  if (value?.version !== 1 || value.device?.id !== device.id || !Array.isArray(value.items) || value.items.length > 20000) {
    throw taskCenterError('UNSUPPORTED_NODE', '设备尚不支持统一任务管理，请更新该节点', 503);
  }
  const identities = new Set();
  const items = value.items.map(item => {
    if (!['checklist', 'dispatch'].includes(item?.source) || item.ownerDeviceId !== device.id || typeof item.id !== 'string' ||
      typeof item.scopeId !== 'string' || typeof item.text !== 'string' || !/^[0-9a-f]{64}$/.test(item.revision || '')) {
      throw taskCenterError('INVALID_SNAPSHOT', '设备返回的任务身份无效', 502);
    }
    const key = taskKey(device.id, item.scopeId, item.id);
    if (identities.has(key)) throw taskCenterError('INVALID_SNAPSHOT', '设备返回了重复任务身份', 502);
    identities.add(key);
    const assignedProvider = item.assignedThreadId ? taskProvider(item.assignedProvider ?? 'codex') : null;
    return { ...item, assignedProvider, key, ownerDeviceId: device.id };
  });
  const supportedProviders = Array.isArray(value.supportedProviders) ? [...new Set(value.supportedProviders.map(taskProvider))] : ['codex'];
  return { supportedProviders, device, status: 'connected', updatedAt: value.updatedAt, items, message: null };
}

export class TaskCenterFederation {
  constructor({ localOwner, localDevice, peers = [], clock = Date.now, cacheMs = 5000 } = {}) {
    Object.assign(this, { localOwner, localDevice, peers, clock, cacheMs });
    this.cache = new Map(); this.pending = new Map(); this.nextReads = new Map(); this.failures = new Map(); this.generations = new Map();
  }
  sources() {
    return [{ device: this.localDevice, adapter: this.localOwner },
      ...this.peers.map(({ peer, taskCenter }) => ({ device: { id: peer.id, name: peer.name, kind: 'remote-codex' }, adapter: taskCenter }))];
  }
  source(id) {
    const source = this.sources().find(entry => entry.device.id === id);
    if (!source) throw taskCenterError('UNKNOWN_DEVICE', '未知任务所属设备', 404);
    return source;
  }
  refresh(source) {
    const id = source.device.id;
    if (this.pending.has(id)) return this.pending.get(id);
    const generation = this.generations.get(id) || 0;
    const current = () => generation === (this.generations.get(id) || 0);
    const pending = Promise.resolve().then(() => source.adapter.read()).then(value => {
      if (!current()) return;
      this.cache.set(id, snapshotFor(value, source.device)); this.failures.delete(id);
    }).catch(error => {
      if (!current()) return;
      const previous = this.cache.get(id);
      this.failures.set(id, (this.failures.get(id) || 0) + 1);
      this.cache.set(id, { device: source.device, status: error.code === 'UNSUPPORTED_NODE' ? 'unsupported' : 'offline',
        supportedProviders: previous?.supportedProviders || ['codex'], updatedAt: previous?.updatedAt || null, items: previous?.items || [],
        message: error.code === 'UNSUPPORTED_NODE' ? error.message : '设备暂不可读；保留上次任务，恢复连接后可管理' });
    }).finally(() => {
      this.pending.delete(id);
      this.nextReads.set(id, current() ? this.clock() + Math.min(60000, this.cacheMs * 2 ** (this.failures.get(id) || 0)) : 0);
    });
    this.pending.set(id, pending); return pending;
  }
  async read({ force = false, wait = false } = {}) {
    const sources = this.sources();
    for (const source of sources) if (force || this.clock() >= (this.nextReads.get(source.device.id) || 0)) void this.refresh(source);
    if (wait) await Promise.all(sources.map(source => this.pending.get(source.device.id)));
    else if (!this.cache.has(this.localDevice.id)) await this.pending.get(this.localDevice.id);
    return { version: 1, localDeviceId: this.localDevice.id, devices: sources.map(source => this.cache.get(source.device.id) ||
      { device: source.device, status: 'loading', items: [], updatedAt: null, message: '正在读取设备任务' }) };
  }
  async apply(input) {
    const action = normalizeTaskCenterAction(input), source = this.source(action.ownerDeviceId), id = source.device.id;
    await this.pending.get(id);
    if (action.assignedProvider === 'terminal' && id !== this.localDevice.id) throw taskCenterError('UNSUPPORTED_PROVIDER', '终端会话目前只支持领取本机来源的任务；远端任务保持不变', 409);
    this.generations.set(id, (this.generations.get(id) || 0) + 1);
    try {
      const result = await source.adapter.apply(action);
      if (result?.applied !== true || result.requestId !== action.requestId) throw taskCenterError('UNCONFIRMED', '来源设备未确认操作结果，请刷新核对', 409);
      this.generations.set(id, (this.generations.get(id) || 0) + 1);
      const previous = this.cache.get(id), key = taskKey(id, action.scopeId, action.id);
      const items = (previous?.items || []).filter(item => item.key !== key);
      if (result.item) {
        const validated = snapshotFor({ version: 1, device: source.device, items: [result.item] }, source.device);
        items.push(validated.items[0]);
      }
      this.cache.set(id, { supportedProviders: previous?.supportedProviders || ['codex'], device: source.device, status: 'connected', items, updatedAt: new Date(this.clock()).toISOString(), message: null });
      this.nextReads.delete(id);
      // Return the confirmed write immediately; the next read refreshes the directory.
      // Waiting for a second SSH read can outlive the native delivery reservation waiter.
      return { ...result, ownerDeviceId: id };
    } catch (error) {
      this.nextReads.delete(id);
      throw error;
    }
  }
  async imageBundle(item) {
    const source = this.source(item.ownerDeviceId);
    if (!source.adapter.images) throw taskCenterError('IMAGES_UNAVAILABLE', '来源设备暂不支持图片传输', 503);
    return source.adapter.images({ scopeId: item.scopeId, id: item.id, expectedRevision: item.revision });
  }
}
