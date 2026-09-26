import { AccountUsageReader } from './account-usage.mjs';
import { TurboCoordinator } from './turbo-control.mjs';
import { TurboQuotaMonitor } from './turbo-quota-monitor.mjs';

export function createTurboRuntime({ config, localService, peerAdapters, routingService, reader = null } = {}) {
  const coordinator = new TurboCoordinator({ localService, peerAdapters, localNode: config.nodeDevice, routingService });
  const monitor = new TurboQuotaMonitor({ coordinator, reader: reader || new AccountUsageReader({ codexPath: config.codexPath, codexHome: config.nativeCodexHome }) });
  coordinator.quotaStatusProvider = () => monitor.snapshot();
  return { coordinator, monitor,
    policyProvider: { snapshot: () => ({ ...localService.snapshot(), quotaStatus: monitor.snapshot() }) },
    start: () => monitor.start(), stop: () => monitor.stop() };
}
