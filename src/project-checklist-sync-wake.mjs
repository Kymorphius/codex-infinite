// Coalesce explicit checklist wake-ups without racing the periodic injector pass.
export const PROJECT_CHECKLIST_SYNC_BINDING = 'codexControlConsoleChecklistSync';
export function createProjectChecklistSyncWake({ run, canRun, onError }) {
  let pending = false, inFlight = null;
  function flush() {
    if (inFlight || !pending || !canRun()) return inFlight;
    pending = false;
    inFlight = Promise.resolve().then(run).catch(onError).finally(() => {
      inFlight = null;
      if (pending) flush();
    });
    return inFlight;
  }
  return {
    request() { pending = true; return flush(); },
    resume: flush,
    busy: () => Boolean(inFlight),
    clear() { pending = false; },
    async settle() { while (inFlight) await inFlight; }
  };
}
