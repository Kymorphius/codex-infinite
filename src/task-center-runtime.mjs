import path from 'node:path';
import { TaskCenterOwner } from './task-center-owner.mjs';
import { TaskCenterFederation } from './task-center-federation.mjs';
import { TaskCenterChecklistProjection } from './task-center-checklist-projection.mjs';
import { SshPeerTaskCenter } from './ssh-peer-task-center.mjs';
import { createTaskCenterImages } from './task-center-images.mjs';
import { taskCenterError } from './task-center-contract.mjs';

export function createTaskCenterRuntime({ config, checklistStore, dispatchStore, adapter, peers }) {
  let service;
  const images = createTaskCenterImages({ directory: path.join(config.wrapperCodexHome, 'task-images'),
    localDevice: config.nodeDevice, store: checklistStore, fetchRemoteBundle: item => service.imageBundle(item) });
  const verifyTarget = async ({ deviceId, threadId }) => {
    const snapshot = await adapter.listTasks();
    const device = snapshot.devices?.find(value => value.id === deviceId);
    const task = snapshot.tasks?.find(value => value.id === threadId && value.device?.id === deviceId);
    if (!device || device.status !== 'connected' || (threadId && !task)) throw taskCenterError('TARGET_UNAVAILABLE', '目标设备或会话暂不可用，请刷新后重新选择', 409);
    return task || device;
  };
  const owner = new TaskCenterOwner({ checklistStore, dispatchStore, localDevice: config.nodeDevice, verifyTarget,
    prepareAssignment: value => images.prepareAssignment(value) });
  const remoteSources = peers.map(peer => ({ peer, taskCenter: new SshPeerTaskCenter({ peer,
    actionKeyPath: path.join(config.peerActionKeyDirectory, `${peer.id}.key`) }) }));
  service = new TaskCenterFederation({ localOwner: owner, localDevice: config.nodeDevice, peers: remoteSources });
  const projection = new TaskCenterChecklistProjection({ store: checklistStore, service, localDevice: config.nodeDevice, images });
  return { service, owner, images, projection };
}
