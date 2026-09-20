import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sshExperimentsArguments } from './ssh-peer-commands.mjs';
import { normalizeExperimentSnapshot } from './experiment-contract.mjs';

export class ExperimentService {
  constructor({ localAdapter, localDevice, peers = [], execFile = promisify(nodeExecFile) }) {
    Object.assign(this, { localAdapter, localDevice, peers, execFile });
  }
  async readLocal() {
    try { return normalizeExperimentSnapshot(await this.localAdapter.read()); }
    catch { return normalizeExperimentSnapshot(null); }
  }
  async readPeer(peer) {
    for (const transport of peer.transports) {
      try {
        const { stdout } = await this.execFile('ssh', sshExperimentsArguments(transport, { remotePlatform: peer.platform }),
          { encoding: 'utf8', timeout: 18000, maxBuffer: 2 * 1024 * 1024 });
        return normalizeExperimentSnapshot(JSON.parse(stdout));
      } catch { /* Try the next configured authenticated transport. */ }
    }
    return normalizeExperimentSnapshot(null);
  }
  async read() {
    const sources = [{ device: this.localDevice, read: () => this.readLocal() },
      ...this.peers.map(peer => ({ device: { id: peer.id, name: peer.name }, read: () => this.readPeer(peer) }))];
    return { devices: await Promise.all(sources.map(async ({ device, read }) => ({
      device: { id: device.id, name: device.name }, snapshot: await read()
    }))) };
  }
}
