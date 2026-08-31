import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_TASK_REFRESH_MS,
  IDLE_TASK_REFRESH_MS,
  createAdaptiveRefreshScheduler,
  taskRefreshDelay
} from "../public/core/refresh-policy.js";

test("task refresh accelerates only while normalized tasks are active", () => {
  assert.equal(taskRefreshDelay([{ status: "completed" }]), IDLE_TASK_REFRESH_MS);
  assert.equal(taskRefreshDelay([{ status: "completed" }, { status: "active" }]), ACTIVE_TASK_REFRESH_MS);
  assert.equal(taskRefreshDelay([]), IDLE_TASK_REFRESH_MS);
});

test("adaptive scheduler chooses the next delay after refresh and stops cleanly", async () => {
  const timers = [];
  const cleared = [];
  let delay = 2000;
  let refreshes = 0;
  const scheduler = createAdaptiveRefreshScheduler({
    refresh: async () => { refreshes += 1; delay = 15000; },
    nextDelay: () => delay,
    setTimer(callback, milliseconds) {
      const timer = { callback, milliseconds };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => cleared.push(timer)
  });

  scheduler.start();
  scheduler.start();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].milliseconds, 2000);
  await timers[0].callback();
  assert.equal(refreshes, 1);
  assert.equal(timers[1].milliseconds, 15000);
  scheduler.stop();
  assert.deepEqual(cleared, [timers[1]]);
});
