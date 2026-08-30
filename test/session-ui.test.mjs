import test from "node:test";
import assert from "node:assert/strict";
import { filterSessions, groupSessionsByDevice, groupSessionsByDirectory } from "../public/features/sessions/model.js";
import { SessionDisclosureState, summarizeSessionDevice } from "../public/features/sessions/disclosure.js";

const local = { id: "local", name: "Local", status: "connected", kind: "local-codex", location: "本机" };
const remote = { id: "remote", name: "Remote", status: "connected", kind: "remote-codex", location: "Linux" };
const tasks = [
  { id: "2", title: "new local", project: "beta", cwd: "/work/beta", model: "sol", status: "active", updatedAt: "2026-08-29T12:00:00Z", device: local },
  { id: "1", title: "old local", project: "alpha", cwd: "/work/alpha", model: "terra", status: "completed", updatedAt: "2026-08-28T12:00:00Z", device: local },
  { id: "3", title: "remote failure", project: "gamma", cwd: "/srv/gamma", model: "luna", status: "interrupted", updatedAt: "2026-08-30T12:00:00Z", device: remote }
];

test("session directories remain distinct and newest directory is first", () => {
  const groups = groupSessionsByDirectory(tasks.slice(0, 2));
  assert.deepEqual(groups.map((group) => group.directory), ["/work/beta", "/work/alpha"]);
  assert.deepEqual(groups.map((group) => group.tasks[0].id), ["2", "1"]);
});

test("session devices group normalized tasks and order by latest activity", () => {
  const devices = groupSessionsByDevice([local, remote], tasks);
  assert.deepEqual(devices.map((device) => device.id), ["remote", "local"]);
  assert.equal(devices[1].projects.length, 2);
});

test("an unavailable peer remains visible even without readable sessions", () => {
  const offline = { id: "offline", name: "Offline", status: "error", kind: "remote-codex", location: "远程" };
  const groups = groupSessionsByDevice([local, offline], tasks.filter((task) => task.device.id === "local"));
  assert.equal(groups.some((device) => device.id === "offline" && device.projects.length === 0), true);
});

test("session filtering searches metadata and normalizes interrupted as error", () => {
  assert.deepEqual(filterSessions(tasks, { query: "TERRA" }).map((task) => task.id), ["1"]);
  assert.deepEqual(filterSessions(tasks, { status: "active" }).map((task) => task.id), ["2"]);
  assert.deepEqual(filterSessions(tasks, { status: "error" }).map((task) => task.id), ["3"]);
});

test("device summaries stay useful while a device is collapsed", () => {
  const [device] = groupSessionsByDevice([local], tasks.filter((task) => task.device.id === "local"));
  assert.deepEqual(summarizeSessionDevice(device), {
    projectCount: 2,
    sessionCount: 2,
    activeCount: 1,
    latestAt: "2026-08-29T12:00:00Z"
  });
});

test("disclosure choices survive renders while filters temporarily reveal matches", () => {
  const disclosure = new SessionDisclosureState();
  disclosure.setDeviceOpen("local", false);
  disclosure.setProjectOpen("local", "/work/beta", false);
  assert.equal(disclosure.isDeviceOpen("local", { query: "", status: "all" }), false);
  assert.equal(disclosure.isProjectOpen("local", "/work/beta", true, { query: "", status: "all" }), false);
  assert.equal(disclosure.isDeviceOpen("local", { query: "beta", status: "all" }), true);
  assert.equal(disclosure.isProjectOpen("local", "/work/beta", false, { query: "beta", status: "all" }), true);
  assert.equal(disclosure.isDeviceOpen("local", { query: "", status: "all" }), false);
});
