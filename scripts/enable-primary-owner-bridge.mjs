import { getConfig } from "../src/config.mjs";
import { PrimaryOwnerLauncher } from "../src/primary-owner-launch.mjs";

const confirmIdle = process.argv.includes("--confirm-idle");
const config = getConfig();
const response = await fetch(`${config.dashboardOrigin}/api/node/snapshot`).catch(() => null);
if (!response?.ok) throw new Error("无法读取本机任务状态，未重启原生 ChatGPT");
const snapshot = await response.json();
const activeThreadIds = (Array.isArray(snapshot.tasks) ? snapshot.tasks : [])
  .filter((task) => ["active", "running", "in_progress"].includes(task?.status))
  .map((task) => task.id);
const launcher = new PrimaryOwnerLauncher({ config });
await launcher.relaunch({ confirmIdle, activeThreadIds });
console.log("原生 ChatGPT 已使用仅限本机的会话桥接重新启动。");
