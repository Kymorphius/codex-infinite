import crypto from "node:crypto";
import fs from "node:fs/promises";

export const ACTION_HEADERS = Object.freeze({
  timestamp: "x-codex-node-timestamp",
  nonce: "x-codex-node-nonce",
  signature: "x-codex-node-signature"
});

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;

export async function loadActionKey(filePath) {
  if (!filePath) throw new Error("Node action key is not configured");
  const [stat, content] = await Promise.all([fs.stat(filePath), fs.readFile(filePath, "utf8")]);
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error("Node action key permissions must be 0600");
  const normalized = content.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) throw new Error("Node action key is invalid");
  const key = Buffer.from(normalized, "base64");
  if (key.length !== 32) throw new Error("Node action key must contain 32 bytes");
  return key;
}

export function actionCanonical({ method, path, timestamp, nonce, body }) {
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  return `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

export function signPeerAction(key, request) {
  return crypto.createHmac("sha256", key).update(actionCanonical(request)).digest("hex");
}

export class NonceReplayWindow {
  constructor({ ttlMs = 30_000, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.nonces = new Map();
  }

  consume(nonce) {
    const now = this.now();
    for (const [value, expiresAt] of this.nonces) if (expiresAt <= now) this.nonces.delete(value);
    if (this.nonces.has(nonce)) return false;
    this.nonces.set(nonce, now + this.ttlMs);
    return true;
  }
}

export function verifyPeerAction({ key, method, path, headers, body, replayWindow, now = Date.now(), maxSkewMs = 30_000 }) {
  const timestamp = String(headers[ACTION_HEADERS.timestamp] || "");
  const nonce = String(headers[ACTION_HEADERS.nonce] || "");
  const signature = String(headers[ACTION_HEADERS.signature] || "");
  const timestampMs = Number(timestamp);
  if (!Number.isSafeInteger(timestampMs) || Math.abs(now - timestampMs) > maxSkewMs) return { ok: false, reason: "stale" };
  if (!NONCE_PATTERN.test(nonce) || !SIGNATURE_PATTERN.test(signature)) return { ok: false, reason: "invalid" };
  const expected = signPeerAction(key, { method, path, timestamp, nonce, body });
  if (!crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) return { ok: false, reason: "invalid" };
  if (!replayWindow.consume(nonce)) return { ok: true, duplicate: true };
  return { ok: true, duplicate: false };
}

