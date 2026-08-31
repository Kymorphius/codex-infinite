export const ACTIVE_TASK_REFRESH_MS = 2000;
export const IDLE_TASK_REFRESH_MS = 15000;
export const OPEN_CONVERSATION_REFRESH_MS = 2000;

export function taskRefreshDelay(tasks = []) {
  return tasks.some((task) => task?.status === "active")
    ? ACTIVE_TASK_REFRESH_MS
    : IDLE_TASK_REFRESH_MS;
}

export function createAdaptiveRefreshScheduler({ refresh, nextDelay, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let stopped = false;

  async function tick() {
    timer = null;
    try {
      await refresh();
    } finally {
      if (!stopped) timer = setTimer(tick, nextDelay());
    }
  }

  function start() {
    if (stopped || timer) return;
    timer = setTimer(tick, nextDelay());
  }

  function stop() {
    stopped = true;
    if (timer) clearTimer(timer);
    timer = null;
  }

  return { start, stop };
}
