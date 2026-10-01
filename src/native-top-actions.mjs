import { buildNativeOpenLocalProjectInjectionScript } from './native-open-local-project.mjs';
import { buildNativeButlerEntryScript } from './native-butler-entry.mjs';

// Sidebar top-action injections shared by the dedicated and primary-app injectors.
export function buildNativeTopActionScripts({ butlerCwd = '' } = {}) {
  return [buildNativeOpenLocalProjectInjectionScript(), ...(butlerCwd ? [buildNativeButlerEntryScript({ cwd: butlerCwd })] : [])];
}
