import { createHash } from 'node:crypto';

const connections = new WeakMap();
const MAX_KEYS = 32;
const MAX_AGE_MS = 30_000;
const MARKER = '__codexControlConsoleInstallerCache';

function entryFor(connection, key, build) {
  let entries = connections.get(connection);
  if (!entries) connections.set(connection, entries = new Map());
  if (entries.has(key)) return entries.get(key);
  const built = build();
  const sources = Object.freeze(Array.isArray(built) ? [...built] : [built]);
  if (!sources.length || sources.some(source => typeof source !== 'string' || !source)) throw Error('Invalid native installer source');
  const digest = createHash('sha256').update(JSON.stringify(sources)).digest('hex');
  const entry = { sources, digest, installedAt: null, pending: null };
  if (entries.size >= MAX_KEYS) entries.delete(entries.keys().next().value);
  entries.set(key, entry);
  return entry;
}

/** Reuse trusted static source construction for document-start registration too. */
export function nativeInstallerSources(connection, key, build) {
  return entryFor(connection, key, build).sources;
}

/** Readiness is trusted JS yielding truthy component checks and version values. */
export async function installNativeCached(connection, { key, build, readiness = '[true]', force = false,
  maxAgeMs = MAX_AGE_MS, now = Date.now, beforeInstall = null } = {}) {
  const entry = entryFor(connection, key, build);
  if (entry.pending) return entry.pending;
  const operation = async () => {
    const keyLiteral = JSON.stringify(key), digestLiteral = JSON.stringify(entry.digest);
    const age = now() - entry.installedAt;
    const maximumAge = Math.max(1, Math.min(MAX_AGE_MS, Number(maxAgeMs) || MAX_AGE_MS));
    if (!force && entry.installedAt !== null && age >= 0 && age < maximumAge) {
      const ready = await connection.evaluate(`(() => {
        const marker = window.${MARKER}?.[${keyLiteral}], checks = (${readiness});
        return Boolean(marker?.digest === ${digestLiteral} && Array.isArray(checks) && checks.every(Boolean)
          && marker.readiness === JSON.stringify(checks));
      })()`).catch(error => { entry.installedAt = null; throw error; });
      if (ready === true) { await beforeInstall?.(); return { installed: false }; }
    }
    entry.installedAt = null;
    await beforeInstall?.();
    const stamp = `;(() => { const checks = (${readiness});
      (window.${MARKER} ||= Object.create(null))[${keyLiteral}] = { digest: ${digestLiteral}, readiness: JSON.stringify(checks) };
    })()`;
    for (let index = 0; index < entry.sources.length; index++) {
      await connection.evaluate(entry.sources[index] + (index === entry.sources.length - 1 ? stamp : ''));
    }
    entry.installedAt = now();
    return { installed: true };
  };
  entry.pending = operation().finally(() => { entry.pending = null; });
  return entry.pending;
}
