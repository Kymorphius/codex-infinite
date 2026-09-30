import { existsSync } from 'node:fs';
import path from 'node:path';

// The dedicated native app home is authoritative for its available models. The shared
// CLI cache remains a fallback when the native app has not populated its own cache yet.
export function resolveModelCatalogPath({ overridePath, nativeCodexHome, sourceCodexHome, platform = process.platform, fileExists = existsSync }) {
  if (overridePath) return overridePath;
  const hostPath = platform === 'win32' ? path.win32 : path.posix;
  const nativeCache = hostPath.join(nativeCodexHome, 'models_cache.json');
  return fileExists(nativeCache) ? nativeCache : hostPath.join(sourceCodexHome, 'models_cache.json');
}
