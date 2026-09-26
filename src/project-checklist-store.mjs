import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import { normalizeChecklistAction } from './project-checklist-contract.mjs';
import { checklistTimeMetadata } from './project-checklist-time.mjs';
import { taskInputAfterTextEdit } from './project-checklist-input.mjs';
import { changeTaskItem, normalizeTaskCenterAction, taskCenterError, taskRevision, validateTaskScopeId } from './task-center-contract.mjs';
import { TaskCenterReceiptArchive } from './task-center-receipts.mjs';
export class ProjectChecklistStore {
  constructor(directory) { this.directory = directory; this.chain = Promise.resolve(); this.taskReceiptIndex = null; this.receiptArchive = new TaskCenterReceiptArchive(directory); }
  scopeId(key) {
    if (typeof key !== 'string' || !key.trim() || key.length > 1000) throw Error('无效项目');
    return createHash('sha256').update(key).digest('hex');
  }
  file(key) { return this.scopeFile(this.scopeId(key)); }
  scopeFile(scopeId) { return path.join(this.directory, validateTaskScopeId(scopeId) + '.json'); }
  async checkDirectory() {
    const stat = await fs.lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('清单目录不能是符号链接');
  }
  async read(key) { return this.readScope(this.scopeId(key)); }
  async readScope(scopeId) {
    const file = this.scopeFile(scopeId);
    let handle;
    try {
      await this.checkDirectory();
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error('清单文件不能是符号链接');
      handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      if ((await handle.stat()).size > 8_000_000) throw Error('清单过大');
      const data = JSON.parse(await handle.readFile('utf8'));
      if (data.version !== 1 || !Array.isArray(data.items) || !Array.isArray(data.receipts)) throw Error('清单损坏');
      if (data.items.length > 1000 || data.receipts.some(id => typeof id !== 'string')) throw Error('清单损坏');
      if (data.taskReceipts !== undefined && (!Array.isArray(data.taskReceipts) || data.taskReceipts.some(receipt => !receipt || typeof receipt.requestId !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.actionHash) || receipt.result?.requestId !== receipt.requestId || receipt.result?.applied !== true))) throw Error('任务回执损坏');
      const ids = new Set();
      for (const item of data.items) {
        normalizeChecklistAction({ ...item, projectKey: scopeId, requestId: 'validate', type: 'upsert' });
        if (ids.has(item.id)) throw Error('清单包含重复任务');
        ids.add(item.id);
      }
      return { ...data, items: data.items.map(item => ({ ...item, ...checklistTimeMetadata(item) })) };
    } catch (error) { if (error.code === 'ENOENT') return { version: 1, items: [], receipts: [] }; throw error; }
    finally { await handle?.close(); }
  }
  async listScopes() {
    await this.chain;
    let entries;
    try { await this.checkDirectory(); entries = await fs.readdir(this.directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const result = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!/^[0-9a-f]{64}\.json$/.test(entry.name) || !entry.isFile() || entry.isSymbolicLink()) continue;
      const scopeId = entry.name.slice(0, -5), data = await this.readScope(scopeId);
      result.push({ scopeId, items: data.items });
    }
    return result;
  }
  enqueue(work) {
    const operation = this.chain.then(work);
    this.chain = operation.catch(() => {});
    return operation;
  }
  async loadTaskReceipts() {
    if (this.taskReceiptIndex) return this.taskReceiptIndex;
    const index = new Map();
    let entries;
    try { await this.checkDirectory(); entries = await fs.readdir(this.directory, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
    for (const entry of entries) {
      if (!/^[0-9a-f]{64}\.json$/.test(entry.name) || !entry.isFile() || entry.isSymbolicLink()) continue;
      for (const receipt of (await this.readScope(entry.name.slice(0, -5))).taskReceipts || []) {
        if (index.has(receipt.requestId) && index.get(receipt.requestId).actionHash !== receipt.actionHash) throw Error('任务请求回执存在冲突');
        index.set(receipt.requestId, receipt);
      }
    }
    this.taskReceiptIndex = index;
    return index;
  }
  async writeScope(scopeId, data) {
    const text = JSON.stringify(data);
    if (data.items.length > 1000) throw Error('清单最多保存 1000 项');
    if (Buffer.byteLength(text) > 8_000_000) throw Error('清单过大');
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.checkDirectory();
    const target = this.scopeFile(scopeId), temporary = target + '.' + randomUUID() + '.tmp';
    try {
      const stat = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw Error('清单文件不能是符号链接');
      await fs.writeFile(temporary, text, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, target);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  async archiveReceipts(data) {
    for (const receipt of data.taskReceipts || []) {
      await this.receiptArchive.store(receipt);
      this.taskReceiptIndex?.delete(receipt.requestId);
    }
    data.taskReceipts = [];
  }
  apply(value) {
    const action = normalizeChecklistAction(value);
    return this.enqueue(async () => {
      const data = await this.read(action.projectKey);
      if (data.receipts.includes(action.requestId)) return action.requestId;
      const index = data.items.findIndex(item => item.id === action.id);
      if (action.creation && index >= 0) throw taskCenterError('TASK_EXISTS', '任务已存在，请刷新后重试', 409);
      if (data.items[index]?.deliveryReservation) throw taskCenterError('DELIVERY_RESERVED', '任务正在交付或结果待核对，请先核对目标会话', 409);
      if (action.type === 'delete') data.items = data.items.filter(item => item.id !== action.id);
      else {
        const updatedAt = new Date().toISOString();
        const time = index >= 0 ? checklistTimeMetadata(data.items[index]) : checklistTimeMetadata(Object.prototype.hasOwnProperty.call(action, 'createdAt') ? action : { ...action, createdAt: updatedAt });
        const previous = index >= 0 ? data.items[index] : null;
        const input = previous ? taskInputAfterTextEdit(action.input || previous.input, previous.text, action.text) : action.input;
        const item = { ...previous, id: action.id, text: action.text, done: action.done, assignedThreadId: action.assignedThreadId, updatedAt, ...time, ...(input ? { input } : {}) };
        for (const key of ['assignedDeviceId', 'executionState']) if (Object.hasOwn(action, key)) item[key] = action[key];
        if (index >= 0) data.items[index] = item; else data.items.push(item);
      }
      data.receipts = [...data.receipts, action.requestId].slice(-2000);
      if (data.taskReceipts?.length) await this.archiveReceipts(data);
      await this.writeScope(this.scopeId(action.projectKey), data);
      return action.requestId;
    });
  }
  applyTaskAction(value, { verifyTarget, prepareAssignment, localDeviceId } = {}) {
    const action = normalizeTaskCenterAction(value), actionHash = taskRevision(value);
    return this.enqueue(async () => {
      if (action.ownerDeviceId !== localDeviceId) throw taskCenterError('WRONG_OWNER', '此设备不是任务来源', 409);
      const data = await this.readScope(action.scopeId);
      const receiptIndex = await this.loadTaskReceipts();
      const receipt = receiptIndex.get(action.requestId) || await this.receiptArchive.read(action.requestId);
      if (receipt) {
        if (receipt.actionHash !== actionHash) throw taskCenterError('REQUEST_ID_CONFLICT', '同一请求编号不能用于不同操作', 409);
        if (action.type === 'verify-delivery' && !data.items.some(item => item.id === action.id && item.deliveryReservation?.token === receipt.result.item?.deliveryReservation?.token)) throw taskCenterError('RESERVATION_CLOSED', '此次交付预占已结束，请刷新后核对结果', 409);
        return structuredClone(receipt.result);
      }
      const index = data.items.findIndex(item => item.id === action.id), previous = data.items[index];
      if (action.type === 'create') {
        if (previous) throw taskCenterError('TASK_EXISTS', '任务已存在，请刷新后重试', 409);
      } else {
        if (!previous) throw taskCenterError('TASK_NOT_FOUND', '任务已删除或不存在', 404);
        if (taskRevision(previous) !== action.expectedRevision) throw taskCenterError('REVISION_CONFLICT', '任务已在其他设备修改，请刷新后重试', 409);
      }
      const reservation = previous?.deliveryReservation;
      if (reservation && !['delivered', 'release-delivery'].includes(action.type)) throw taskCenterError('DELIVERY_RESERVED', '任务正在交付或结果待核对，请先核对目标会话', 409);
      if (action.type === 'release-delivery' && (!reservation || reservation.token !== action.reservationToken)) throw taskCenterError('RESERVATION_MISMATCH', '交付预占凭证已失效，请核对目标会话', 409);
      if (action.type === 'verify-delivery') {
        if (previous.done || previous.executionState === 'delivered') throw taskCenterError('TASK_NOT_PENDING', '任务已完成或交付，请刷新后重试', 409);
        const assignedDeviceId = previous.assignedDeviceId || localDeviceId;
        if (previous.assignedThreadId ? action.assignedDeviceId !== assignedDeviceId || action.assignedThreadId !== previous.assignedThreadId : action.assignedThreadId !== null) throw taskCenterError('TARGET_MISMATCH', '任务已改派，请刷新后重试', 409);
        if (typeof verifyTarget !== 'function' || !(await verifyTarget({ deviceId: action.assignedDeviceId, threadId: action.assignedThreadId }))) throw taskCenterError('TARGET_UNAVAILABLE', '目标设备或会话不可用', 409);
      }
      if (action.type === 'delivered') {
        if (!reservation || action.reservationToken !== reservation.token) throw taskCenterError('RESERVATION_MISMATCH', '交付预占凭证已失效，请核对目标会话', 409);
        const deviceId = action.assignedDeviceId || previous.assignedDeviceId || localDeviceId;
        const threadId = action.assignedThreadId || previous.assignedThreadId;
        if (deviceId !== reservation.assignedDeviceId || !threadId || (reservation.assignedThreadId && threadId !== reservation.assignedThreadId)) throw taskCenterError('TARGET_MISMATCH', '交付目标与预占不符，请核对目标会话', 409);
        if (typeof verifyTarget !== 'function' || !(await verifyTarget({ deviceId, threadId }))) throw taskCenterError('TARGET_UNAVAILABLE', '目标设备或会话不可用', 409);
      }
      if (action.type === 'assign') {
        const target = { deviceId: action.assignedDeviceId, threadId: action.assignedThreadId };
        if (typeof verifyTarget !== 'function' || !(await verifyTarget(target))) throw taskCenterError('TARGET_UNAVAILABLE', '目标设备或会话不可用', 409);
        const input = action.input || previous?.input || [];
        if (action.assignedDeviceId !== localDeviceId && input.some(part => part.type !== 'text')) {
          if (typeof prepareAssignment !== 'function') throw taskCenterError('CROSS_DEVICE_ATTACHMENTS', '任务含本机附件，附件通路不可用；原任务已保留', 409);
          await prepareAssignment({ item: { ...previous, ...(action.input ? { input: action.input } : {}) }, action, target });
        }
      }
      let item;
      if (action.type === 'delete') data.items.splice(index, 1);
      else {
        item = changeTaskItem(previous, action, new Date().toISOString());
        if (action.type === 'verify-delivery') item.deliveryReservation = { token: randomUUID(), requestId: action.requestId, assignedDeviceId: action.assignedDeviceId, assignedThreadId: action.assignedThreadId, createdAt: item.updatedAt };
        if (index >= 0) data.items[index] = item; else data.items.push(item);
      }
      const result = { applied: true, requestId: action.requestId, ...(item ? { item } : {}) };
      const savedReceipt = { requestId: action.requestId, actionHash, result };
      await this.archiveReceipts(data);
      data.taskReceipts = [savedReceipt];
      await this.writeScope(action.scopeId, data);
      receiptIndex.set(action.requestId, savedReceipt);
      return structuredClone(result);
    });
  }
}
