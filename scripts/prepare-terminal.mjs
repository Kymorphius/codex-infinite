import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// node-pty 1.1.0's npm prebuild can lose the helper's executable mode on macOS.
// Repair only its fixed package-local helper paths after npm installs the package.
if (process.platform !== 'win32') {
  for (const relative of [`prebuilds/${process.platform}-${process.arch}/spawn-helper`, 'build/Release/spawn-helper']) {
    const target = fileURLToPath(new URL(`../node_modules/node-pty/${relative}`, import.meta.url));
    try {
      const stat = await fs.lstat(target);
      if (!stat.isFile()) throw new Error('Terminal spawn helper must be a regular file');
      if ((stat.mode & 0o111) !== 0o111) await fs.chmod(target, stat.mode | 0o111);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
