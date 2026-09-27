import fs from 'node:fs/promises';
import path from 'node:path';

// Explicitly supply this dedicated profile's native catalog to the router.
// This does not enable credential/provider discovery or change its transport.
export async function connectWrapperNativeCatalog(wrapperHome) {
  const cachePath = path.join(wrapperHome, 'models_cache.json');
  const routerDirectory = path.join(wrapperHome, 'codex-router');
  const statePath = path.join(routerDirectory, 'native-catalog-source.json');
  const mergedPath = path.join(routerDirectory, 'merged-models.json');
  const read = async file => fs.readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const config = await read(path.join(wrapperHome, 'config.toml')) || '';
  const root = config.split(/^\s*\[/m)[0];
  const assignment = root.match(/^\s*model_catalog_json\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/m);
  if (!assignment) return false;
  let configured;
  try { configured = assignment[1][0] === '"' ? JSON.parse(assignment[1]) : assignment[1].slice(1, -1); } catch { return false; }
  if (path.resolve(configured) !== mergedPath) return false;
  let cache;
  try { cache = JSON.parse(await read(cachePath)); } catch { return false; }
  if (!Array.isArray(cache?.models) || !cache.models.length || !cache.models.every(model => typeof model?.slug === 'string' && (/^gpt-/.test(model.slug) || model.slug === 'codex-auto-review'))) return false;
  const existing = await read(statePath);
  if (existing !== null) {
    // A user's explicit catalog source is not ours to replace.
    try { const state = JSON.parse(existing); return state.version === 1 && state.status === 'active' && state.path === cachePath; } catch { return false; }
  }
  await fs.mkdir(routerDirectory, { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(statePath, JSON.stringify({ version: 1, path: cachePath, status: 'active' }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  return true;
}
