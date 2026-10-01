import { RouterLaunchdAdapter } from "./router-launchd-adapter.mjs";
import { RouterSupervisor } from "./router-supervisor.mjs";

export function createRouterSupervisor(config) {
  const adapter = new RouterLaunchdAdapter({ label: config.routerLaunchAgentLabel, plistPath: config.routerLaunchAgentPath, routerOrigin: config.routerOrigin });
  return new RouterSupervisor({ adapter, autoRepair: config.routerAutoRepair });
}
