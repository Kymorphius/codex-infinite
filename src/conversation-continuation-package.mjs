import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { syncError } from './project-sync-contract.mjs';

const MAX_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const ENDED = new Set(['idle', 'completed', 'interrupted', 'error', 'cancelled']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const validPath = value => typeof value === 'string' && value.length <= 4096 && !/[\0\r\n]/.test(value) && (path.posix.isAbsolute(value) || path.win32.isAbsolute(value));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const inside = (root, candidate) => { const relative = path.relative(root, candidate); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
const graphKey = key => key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();

function graphReferences(value, threadId, allowedOwnPath = '', location = '', metadata = false) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    const normalized = graphKey(key), itemPath = location ? `${location}.${key}` : key;
    if ((normalized.includes('subagent') || normalized.includes('fork')) && item !== null && item !== false && item !== '') {
      throw syncError('首版仅支持独立主会话，子代理或分支会话需完整迁移', 409);
    }
    const reference = /(?:^|_)(?:thread|session|conversation)_ids?$/.test(normalized)
      || /^(?:parent|sender|receiver)(?:_(?:thread|session|conversation))?_ids?$/.test(normalized)
      || /^forked_from_id$/.test(normalized);
    if (reference && item !== null && item !== undefined && item !== '') {
      const values = Array.isArray(item) ? item : [item];
      if (values.some(id => typeof id !== 'string' || id !== threadId)) throw syncError('会话记录引用了其他会话，暂时无法独立复制', 409);
      if (itemPath !== allowedOwnPath && !(metadata && itemPath === 'payload.session_id')) throw syncError('会话记录含有尚不支持的会话关联，请使用完整迁移', 409);
    }
    if (typeof item === 'object') graphReferences(item, threadId, allowedOwnPath, itemPath, metadata);
  }
}

function parseHistory(bytes, threadId) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw syncError('会话记录不是完整的 UTF-8 文件', 400); }
  const offset = bytes.indexOf(10) + 1;
  if (offset <= 0) throw syncError('会话记录缺少完整元数据首行', 400);
  const lines = text.split('\n');
  let metadata;
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) { if (index === 0) throw syncError('会话元数据首行无效', 400); continue; }
    let record;
    try { record = JSON.parse(lines[index]); }
    catch { throw syncError('会话记录包含损坏或未完成的记录', 400); }
    if (!plain(record) || typeof record.type !== 'string' || !plain(record.payload)) throw syncError('会话记录格式无效', 400);
    if (index === 0) {
      if (record.type !== 'session_meta' || !UUID.test(record.payload.id || '') || record.payload.id !== threadId) throw syncError('会话记录标识与所选会话不一致', 409);
      metadata = record.payload;
      if (!validPath(metadata.cwd) || typeof metadata.timestamp !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(metadata.timestamp)
        || !Number.isFinite(Date.parse(metadata.timestamp))) throw syncError('会话记录的目录或时间无效', 400);
      if (/subagent|fork/i.test(metadata.thread_source || '') || /subagent|fork/i.test(typeof metadata.source === 'string' ? metadata.source : '')) throw syncError('首版仅支持独立主会话，子代理或分支会话需完整迁移', 409);
    } else if (record.type === 'session_meta') throw syncError('会话记录包含多个元数据标识', 409);
    const ownPath = index === 0 || ['event_msg', 'token_usage_record'].includes(record.type) ? 'payload.thread_id' : '';
    graphReferences(record, threadId, ownPath, '', index === 0);
  }
  return { metadata, offset };
}

export function validateContinuationPackage(pkg) {
  if (!plain(pkg) || pkg.schemaVersion !== 1 || !UUID.test(pkg.threadId || '') || typeof pkg.title !== 'string'
    || !pkg.title.trim() || pkg.title.length > 512 || /[\0\r\n]/.test(pkg.title) || !validPath(pkg.cwd)
    || typeof pkg.timestamp !== 'string' || !HASH.test(pkg.sha256 || '') || !HASH.test(pkg.bodySha256 || '')
    || !Number.isSafeInteger(pkg.bytes) || pkg.bytes < 1) throw syncError('会话复制包格式无效', 400);
  if (pkg.bytes > MAX_BYTES) throw syncError('会话记录超过 8 MiB，暂时无法复制', 413);
  if (typeof pkg.base64 !== 'string' || pkg.base64.length !== 4 * Math.ceil(pkg.bytes / 3)
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(pkg.base64)) throw syncError('会话复制包编码无效', 400);
  const bytes = Buffer.from(pkg.base64, 'base64');
  if (bytes.length !== pkg.bytes || bytes.toString('base64') !== pkg.base64 || digest(bytes) !== pkg.sha256) throw syncError('会话复制包校验失败，请重新预检', 409);
  const { metadata, offset } = parseHistory(bytes, pkg.threadId);
  if (metadata.cwd !== pkg.cwd || metadata.timestamp !== pkg.timestamp || digest(bytes.subarray(offset)) !== pkg.bodySha256) throw syncError('会话复制包元数据或历史校验失败，请重新预检', 409);
  return { schemaVersion: 1, threadId: pkg.threadId, title: pkg.title, cwd: pkg.cwd, timestamp: pkg.timestamp,
    sha256: pkg.sha256, bodySha256: pkg.bodySha256, bytes: pkg.bytes, base64: pkg.base64 };
}

async function canonicalDirectory(value, message) {
  if (!validPath(value) || !path.isAbsolute(value)) throw syncError(message, 403);
  const resolved = await fs.realpath(value);
  if (!(await fs.stat(resolved)).isDirectory()) throw syncError(message, 403);
  return resolved;
}

async function taskState(threadId, root, taskProvider, taskReader) {
  let tasks, source;
  try { tasks = await taskProvider(); source = await taskReader(threadId); }
  catch { throw syncError('无法确认原生会话状态，请恢复设备窗口后重新预检', 503); }
  if (!Array.isArray(tasks)) throw syncError('无法确认原生会话状态，请重新预检', 503);
  const matches = tasks.filter(task => task?.id === threadId);
  if (matches.length !== 1 || !plain(source) || source.id !== threadId) throw syncError('所选会话已不可读取，请刷新后重新选择', 409);
  const task = matches[0];
  if (!ENDED.has(task.status)) throw syncError('仅可复制已结束的会话，请先等待任务停止并确认状态', 409);
  if (task.isSubagent === true || source.isSubagent === true || task.isFork === true || source.isFork === true) throw syncError('首版仅支持独立主会话，子代理或分支会话需完整迁移', 409);
  graphReferences(task, threadId); graphReferences(source, threadId);
  const cwd = await canonicalDirectory(task.cwd, '会话工作目录不属于所选项目');
  const sourceCwd = await canonicalDirectory(source.cwd, '会话工作目录无法确认');
  if (!inside(root, cwd) || cwd !== sourceCwd) throw syncError('会话工作目录不属于所选项目或已经变化', 409);
  if (!validPath(source.sourceFile)) throw syncError('会话记录路径无效', 403);
  return { task, source, cwd, signature: JSON.stringify({ status: task.status, cwd, sourceFile: source.sourceFile,
    archived: Boolean(task.archived), title: task.title || source.title || '' }) };
}

function fileSignature(stat) { return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`; }
async function boundedRead(handle, expected) {
  const buffer = Buffer.alloc(expected + 1);
  let count = 0;
  while (count < buffer.length) {
    const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
    if (bytesRead === 0) break;
    count += bytesRead;
  }
  if (count !== expected) throw syncError('读取时会话记录发生变化，请重新预检', 409);
  return buffer.subarray(0, count);
}

export async function exportContinuation({ threadId, root, taskProvider, taskReader, sessionRoots } = {}) {
  if (!UUID.test(threadId || '') || typeof taskProvider !== 'function' || typeof taskReader !== 'function'
    || !Array.isArray(sessionRoots) || !sessionRoots.length) throw syncError('会话导出参数或读取目录无效', 400);
  let handle;
  try {
    const projectRoot = await canonicalDirectory(root, '所选项目目录无效');
    const allowed = [];
    for (const directory of sessionRoots) {
      try { allowed.push(await canonicalDirectory(directory, '会话读取目录无效')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!allowed.length) throw syncError('没有可读取的本机会话目录', 503);
    const before = await taskState(threadId, projectRoot, taskProvider, taskReader);
    const sourceFile = before.source.sourceFile, stat = await fs.lstat(sourceFile);
    if (!stat.isFile() || stat.isSymbolicLink()) throw syncError('会话记录必须是普通文件，不能使用符号链接', 403);
    if (stat.size > MAX_BYTES) throw syncError('会话记录超过 8 MiB，暂时无法复制', 413);
    if (stat.size < 1) throw syncError('会话记录为空', 400);
    const canonicalFile = await fs.realpath(sourceFile);
    if (!allowed.some(directory => inside(directory, canonicalFile))) throw syncError('会话记录不在配置的读取目录内', 403);
    handle = await fs.open(canonicalFile, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    if (fileSignature(await handle.stat()) !== fileSignature(stat)) throw syncError('会话记录路径已发生变化，请重新预检', 409);
    const bytes = await boundedRead(handle, stat.size), sha256 = digest(bytes);
    const { metadata, offset } = parseHistory(bytes, threadId);
    if (await canonicalDirectory(metadata.cwd, '会话记录工作目录无效') !== before.cwd) throw syncError('会话记录与当前工作目录不一致，请刷新后重新预检', 409);
    const after = await taskState(threadId, projectRoot, taskProvider, taskReader);
    if (after.signature !== before.signature || (await fs.realpath(sourceFile)) !== canonicalFile
      || fileSignature(await fs.lstat(sourceFile)) !== fileSignature(stat)
      || fileSignature(await handle.stat()) !== fileSignature(stat)
      || digest(await boundedRead(handle, stat.size)) !== sha256
      || fileSignature(await handle.stat()) !== fileSignature(stat)) throw syncError('读取时会话状态或记录发生变化，请重新预检', 409);
    const title = String(before.task.title || before.source.title || `会话 ${threadId.slice(0, 8)}`).replace(/[\0\r\n]/g, ' ').trim().slice(0, 512);
    return validateContinuationPackage({ schemaVersion: 1, threadId, title, cwd: metadata.cwd, timestamp: metadata.timestamp,
      sha256, bodySha256: digest(bytes.subarray(offset)), bytes: bytes.length, base64: bytes.toString('base64') });
  } catch (error) {
    if (error.statusCode) throw error;
    if (error.code === 'ENOENT') throw syncError('会话记录或项目目录已不存在，请刷新后重新预检', 404);
    if (['EACCES', 'EPERM', 'ELOOP'].includes(error.code)) throw syncError('无法安全读取会话记录，请检查目录权限', 403);
    throw syncError('读取会话记录失败，请重新预检', 503);
  } finally { await handle?.close(); }
}
