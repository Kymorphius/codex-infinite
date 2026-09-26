import { createHash } from 'node:crypto';
import { normalizeChecklistInput } from './project-checklist-input.mjs';
import { taskCenterError } from './task-center-contract.mjs';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_TASK_IMAGE_BYTES = 24 * 1024 * 1024;
const DATA = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
export const imageFailure = message => taskCenterError('TASK_IMAGES_UNAVAILABLE', message, 409);
export function imageRefs(input) {
  return input == null ? [] : normalizeChecklistInput(input).filter(part => part.type === 'heldImage').map(part => part.id);
}
export function imageDigest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function imageCacheKey(ownerDeviceId, id) { return imageDigest(JSON.stringify([ownerDeviceId, id])); }
export function projectedImageId(ownerDeviceId, id) {
  const hash = imageCacheKey(ownerDeviceId, id);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}:${id.slice(-1)}`;
}
function mimeFor(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString() === 'GIF8') return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}
export function checkedImage(value, { digestRequired = true } = {}) {
  if (!value || typeof value.dataUrl !== 'string' || value.dataUrl.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64) throw imageFailure('任务图片格式或大小无效');
  const match = DATA.exec(value.dataUrl);
  if (!match) throw imageFailure('任务图片格式无效');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== match[2]) throw imageFailure('任务图片大小或编码无效');
  const mimeType = mimeFor(bytes), sha256 = imageDigest(bytes);
  if (mimeType !== match[1] || (value.mimeType !== undefined && value.mimeType !== mimeType)) throw imageFailure('任务图片内容与类型不符');
  if (digestRequired && value.sha256 !== sha256) throw imageFailure('任务图片完整性校验失败');
  return { id: value.id, mimeType, sha256, dataUrl: value.dataUrl, byteLength: bytes.length };
}
export function checkedBundle(bundle, expectedRefs, options) {
  if (bundle?.version !== 1 || !Array.isArray(bundle.images) || bundle.images.length !== expectedRefs.length || expectedRefs.length > 8) throw imageFailure('任务图片不完整，请在来源设备重新同步');
  const wanted = new Set(expectedRefs), result = new Map(); let total = 0;
  for (const value of bundle.images) {
    if (!wanted.has(value?.id) || result.has(value.id)) throw imageFailure('任务图片引用与原任务不符');
    const image = checkedImage(value, options);
    total += image.byteLength;
    if (total > MAX_TASK_IMAGE_BYTES) throw imageFailure('任务图片总大小超过 24 MiB');
    result.set(image.id, image);
  }
  return expectedRefs.map(id => result.get(id));
}
