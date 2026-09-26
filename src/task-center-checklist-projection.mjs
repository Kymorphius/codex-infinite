import { createHash } from 'node:crypto';
import { taskCenterChecklistItem } from './task-center-contract.mjs';

const GENERAL = 'ccc:general-inbox:v1';
const scopeFor = key => createHash('sha256').update(key).digest('hex');
const identity = item => JSON.stringify([item.ownerDeviceId, item.scopeId, item.id]);

// A renderer projection only. Mutations always go back to the source authority.
export class TaskCenterChecklistProjection {
  constructor({ store, service, localDevice, images = null }) {
    Object.assign(this, { store, service, localDevice, images });
    this.directory = store.directory;
    this.refs = new Map();
  }
  file(key) { return this.store.file(key); }
  async prepare(connection) {
    this.connection = connection;
    if (this.images && Date.now() - (this.lastImageSync || 0) > 30_000) {
      await this.images.sync(connection);
      this.lastImageSync = Date.now();
    }
  }
  async read(projectKey) {
    const snapshot = await this.service.read();
    const scopeId = scopeFor(projectKey), general = projectKey === GENERAL, items = [];
    for (const group of snapshot.devices || []) {
      for (const item of group.items || []) {
        if (item.source !== 'checklist') continue;
        const local = item.ownerDeviceId === this.localDevice.id;
        const target = item.assignedDeviceId || item.ownerDeviceId;
        if (general ? (item.executionState === 'delivered' || (item.assignedThreadId && target !== this.localDevice.id)) : (!local || item.scopeId !== scopeId)) continue;
        const id = local && (item.scopeId === scopeFor(GENERAL) || !general) ? item.id : 'federated-' + createHash('sha256').update(identity(item)).digest('hex');
        this.refs.set(projectKey + ':' + id, item);
        let projected = { ...item, id, sourceRef: { ownerDeviceId: item.ownerDeviceId, scopeId: item.scopeId, id: item.id }, expectedRevision: item.revision, sourceConnected: group.status === 'connected', readOnly: group.status !== 'connected' };
        if (item.deliveryReservation) { projected.readOnly = true; projected.attachmentError = '任务交付待核对，请先检查发送队列或最近会话'; }
        if (!local && item.assignedThreadId && this.images && this.connection) {
          try { projected = { ...projected, input: await this.images.prepareRemoteInput(this.connection, item) }; }
          catch (error) { projected.readOnly = true; projected.attachmentError = error.message || '任务图片尚未同步'; }
        }
        items.push(projected);
      }
    }
    return { version: 1, items, receipts: [] };
  }
  async apply(action) {
    const mapKey = (action.projectKey || GENERAL) + ':' + action.id;
    let known = this.refs.get(mapKey);
    const ref = action.sourceRef || (known && { ownerDeviceId: known.ownerDeviceId, scopeId: known.scopeId, id: known.id });
    if (!ref) {
      if (String(action.id).startsWith('federated-') || !action.creation || action.type !== 'upsert') throw Object.assign(Error('任务缺少来源版本，草稿已保留；请刷新清单后重新保存'), { code: 'REVISION_CONFLICT', statusCode: 409 });
      await this.store.apply({ ...action, ...(action.assignedThreadId ? { assignedDeviceId: this.localDevice.id } : {}) });
      const item = (await this.store.read(action.projectKey)).items.find(value => value.id === action.id);
      const projected = item && taskCenterChecklistItem(item, this.localDevice.id, scopeFor(action.projectKey));
      if (projected) this.refs.set(mapKey, projected);
      return { requestId: action.requestId, item: projected };
    }
    if (action.sourceRef && known && identity(action.sourceRef) !== identity(known)) throw Error('任务来源不匹配，请刷新清单');
    if (!known) {
      const snapshot = await this.service.read();
      known = snapshot.devices.flatMap(group => group.items || []).find(item => identity(item) === identity(ref));
      if (!known) throw Error('任务来源已失效，请刷新清单');
    }
    const expectedRevision = action.expectedRevision;
    if (!expectedRevision) throw Error('任务版本已失效，请刷新清单后重试');
    let type = action.type;
    if (type === 'upsert') {
      if (action.executionState === 'delivered') type = 'delivered';
      else if ((action.assignedThreadId || null) !== (known?.assignedThreadId || null)) type = action.assignedThreadId ? 'assign' : 'return';
      else if (action.done !== known?.done) type = action.done ? 'complete' : 'reopen';
      else type = 'edit';
    }
    const payload = { ...ref, requestId: action.requestId, expectedRevision, type };
    const changesContent = ['edit', 'assign', 'delivered'].includes(type);
    if (changesContent && typeof action.text === 'string') payload.text = action.text;
    if (changesContent && Array.isArray(action.input)) {
      if (ref.ownerDeviceId === this.localDevice.id) payload.input = action.input;
      else if (this.images?.originalInput && known) payload.input = this.images.originalInput(known, action.input);
    }
    if (['assign', 'delivered', 'verify-delivery'].includes(type)) {
      payload.assignedThreadId = action.assignedThreadId || null;
      payload.assignedDeviceId = this.localDevice.id;
    }
    if (action.reservationToken) payload.reservationToken = action.reservationToken;
    const result = await this.service.apply(payload);
    if (result?.item) this.refs.set(mapKey, result.item);
    return { ...result, requestId: action.requestId };
  }
}
