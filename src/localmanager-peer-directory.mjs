import fs from "node:fs/promises";
import net from "node:net";
import { normalizePeerDefinition } from "./peer-contract.mjs";

const MAX_DIRECTORY_BYTES = 4 * 1024 * 1024;

function tailscaleIPv4(value) {
  const address = String(value || "").trim();
  if (net.isIP(address) !== 4) return null;
  const octets = address.split(".").map(Number);
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127 ? address : null;
}

function registrationId(record) {
  return String(record?.registrationId || record?.legacyRegistrationId || "").trim();
}

function hasStableTailscaleBinding(record) {
  return Array.isArray(record?.bindings) && record.bindings.some((binding) => (
    String(binding?.scope || "").startsWith("tailnet:") && String(binding?.nodeId || "").trim()
  ));
}

function directoryRoute(peer, record) {
  if (!record || record.identityConflict) return null;
  if (peer.localManagerRegistrationId && (!record.registered || registrationId(record) !== peer.localManagerRegistrationId)) return null;
  if (peer.localManagerDeviceId && (String(record.id || "") !== peer.localManagerDeviceId || !hasStableTailscaleBinding(record))) return null;
  const source = peer.transports.find((route) => route.type === "direct-ssh");
  if (!source) return null;
  const configuredHosts = new Set(peer.transports.filter((route) => route.type === "direct-ssh").map((route) => route.host));
  const host = (Array.isArray(record.addresses) ? record.addresses : []).map(tailscaleIPv4).find((value) => value && !configuredHosts.has(value));
  return host ? { ...source, host } : null;
}

export function addLocalManagerTailscaleRoutes(peers, directory = {}) {
  if (directory?.format !== 1 || !Array.isArray(directory.devices)) throw new Error("LocalManager device directory format is unsupported");
  const registrations = new Map();
  const devices = new Map();
  for (const record of directory.devices) {
    const registration = registrationId(record);
    if (registration) registrations.set(registration, registrations.has(registration) ? null : record);
    const id = String(record?.id || "").trim();
    if (id) devices.set(id, devices.has(id) ? null : record);
  }
  return peers.map((peer) => {
    if ((!peer.localManagerRegistrationId && !peer.localManagerDeviceId) || peer.transports.length >= 4) return peer;
    const record = peer.localManagerRegistrationId ? registrations.get(peer.localManagerRegistrationId) : devices.get(peer.localManagerDeviceId);
    const route = directoryRoute(peer, record);
    if (!route) return peer;
    const relayIndex = peer.transports.findIndex((item) => item.type === "ssh-relay");
    const index = relayIndex < 0 ? peer.transports.length : relayIndex;
    const transports = [...peer.transports.slice(0, index), route, ...peer.transports.slice(index)];
    return normalizePeerDefinition({ ...peer, transports });
  });
}

export async function resolveLocalManagerPeerRoutes(peers, { filePath, logger = console } = {}) {
  if (!filePath || !peers.some((peer) => peer.localManagerRegistrationId || peer.localManagerDeviceId)) return peers;
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_DIRECTORY_BYTES) throw new Error("LocalManager device directory is invalid or too large");
      const content = await handle.readFile("utf8");
      return addLocalManagerTailscaleRoutes(peers, JSON.parse(content));
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code !== "ENOENT") logger.warn(`[codex-control-console] LocalManager peer hints unavailable: ${error.message}`);
    return peers;
  }
}
