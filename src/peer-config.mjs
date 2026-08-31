import fs from "node:fs/promises";
import { normalizePeerDefinition } from "./peer-contract.mjs";

export async function loadPeerConfig(filePath) {
  if (!filePath) return [];
  let stat;
  let content;
  try {
    [stat, content] = await Promise.all([fs.stat(filePath), fs.readFile(filePath, "utf8")]);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error("Peer config permissions must be 0600");
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed.peers) || parsed.peers.length > 16) throw new Error("Peer config must contain at most 16 peers");
  const peers = parsed.peers.map(normalizePeerDefinition);
  if (new Set(peers.map((peer) => peer.id)).size !== peers.length) throw new Error("Peer ids must be unique");
  return peers;
}
