import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkedImage, imageCacheKey, imageFailure, MAX_IMAGE_BYTES } from './task-center-image-bundle.mjs';

export function createTaskImageStorage(directory) {
  const file = (owner, id) => path.join(directory, `${imageCacheKey(owner, id)}.json`);
  const read = async (owner, id) => {
    const target = file(owner, id);
    try {
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1024) throw imageFailure('任务图片缓存无效');
      const value = JSON.parse(await fs.readFile(target, 'utf8'));
      if (value.ownerDeviceId !== owner || value.id !== id) throw imageFailure('任务图片缓存身份不符');
      return checkedImage(value);
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const write = async (owner, image) => {
    const checked = checkedImage(image);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const target = file(owner, checked.id), temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ ownerDeviceId: owner, ...checked }), { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, target);
    } finally { await fs.rm(temporary, { force: true }); }
  };
  return { read, write };
}
