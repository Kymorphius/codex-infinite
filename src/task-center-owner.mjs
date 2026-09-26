import { normalizeTaskCenterAction, taskCenterChecklistItem, taskKey, taskRevision, validateTaskScopeId } from './task-center-contract.mjs';

export class TaskCenterOwner {
  constructor({ checklistStore, dispatchStore, localDevice, verifyTarget, prepareAssignment }) {
    this.checklistStore = checklistStore;
    this.dispatchStore = dispatchStore;
    this.localDevice = localDevice;
    this.verifyTarget = verifyTarget;
    this.prepareAssignment = prepareAssignment;
  }
  async read() {
    const ownerDeviceId = this.localDevice.id;
    const scopes = await this.checklistStore.listScopes();
    const items = scopes.flatMap(scope => scope.items.map(item => taskCenterChecklistItem(item, ownerDeviceId, scope.scopeId)));
    for (const item of await this.dispatchStore?.list?.() || []) {
      items.push({
        key: taskKey(ownerDeviceId, 'dispatch', item.id), ownerDeviceId, scopeId: 'dispatch', id: item.id, source: 'dispatch',
        title: item.title, text: item.prompt || item.text || item.title || '', status: item.status, done: false,
        assignedThreadId: item.createdThreadId || item.targetThreadId || null,
        assignedDeviceId: item.createdThreadId || item.targetThreadId ? ownerDeviceId : null,
        executionState: item.status === 'sent' ? 'delivered' : null,
        createdAt: item.createdAt || null, updatedAt: item.updatedAt || null,
        revision: taskRevision(item), attachmentCount: 0, scheduledAt: item.scheduledAt || null
      });
    }
    return { version: 1, device: this.localDevice, updatedAt: new Date().toISOString(), items };
  }
  async readTask(scopeId, id) {
    const data = await this.checklistStore.readScope(validateTaskScopeId(scopeId));
    const item = data.items.find(entry => entry.id === id);
    return item ? taskCenterChecklistItem(item, this.localDevice.id, scopeId) : null;
  }
  async apply(value) {
    const action = normalizeTaskCenterAction(value);
    const result = await this.checklistStore.applyTaskAction(value, { verifyTarget: this.verifyTarget, prepareAssignment: this.prepareAssignment, localDeviceId: this.localDevice.id });
    return { ...result, ...(result.item ? { item: taskCenterChecklistItem(result.item, this.localDevice.id, action.scopeId) } : {}) };
  }
}
