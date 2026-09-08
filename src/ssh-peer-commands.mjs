import { ACTION_HEADERS } from "./peer-action-auth.mjs";

export const MESSAGE_ACTION_PATH = "/api/node/actions/message";
export const DRAFT_ACTION_PATH = "/api/node/actions/draft";
export const CONTROL_ACTION_PATH = "/api/node/actions/control";
export const SETTINGS_ACTION_PATH = "/api/node/actions/settings";
export const TURBO_ACTION_PATH = "/api/node/actions/turbo";
export const SKILL_INSTALL_ACTION_PATH = "/api/node/actions/skill-install";
export const SKILL_TOGGLE_ACTION_PATH = "/api/node/actions/skill-toggle";
const ALLOWED_ACTION_PATHS = new Set([MESSAGE_ACTION_PATH, DRAFT_ACTION_PATH, CONTROL_ACTION_PATH, SETTINGS_ACTION_PATH, TURBO_ACTION_PATH, SKILL_INSTALL_ACTION_PATH, SKILL_TOGGLE_ACTION_PATH]);
const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SKILL_SCOPES = new Set(["codex-user", "agents-user", "repo"]);
const SKILL_SOURCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const SNAPSHOT_CURL_TIMEOUT_SECONDS = 25;
const ACTIVITY_CURL_TIMEOUT_SECONDS = 12;
const ACTION_CURL_TIMEOUT_SECONDS = 10;

function sshConnectionArguments(transport) {
  const relay = transport.type === "ssh-relay";
  const target = relay ? `${transport.relayUser}@${transport.relayHost}` : `${transport.user}@${transport.host}`;
  const sshPort = relay ? transport.relayPort : transport.port;
  return [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=4",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "ServerAliveInterval=3",
    "-o", "ServerAliveCountMax=1",
    "-p", String(sshPort),
    target
  ];
}

function encodedPowerShell(source) {
  return Buffer.from(source, "utf16le").toString("base64");
}

const WINDOWS_UTF8_CONSOLE = "$utf8=[Text.UTF8Encoding]::new($false);[Console]::InputEncoding=$utf8;[Console]::OutputEncoding=$utf8;$OutputEncoding=$utf8";

function windowsGetCommand(url, timeoutSeconds) {
  const source = `${WINDOWS_UTF8_CONSOLE};$ErrorActionPreference='Stop';$response=Invoke-WebRequest -UseBasicParsing -TimeoutSec ${timeoutSeconds} -Uri '${url}';[Console]::Out.Write($response.Content)`;
  return ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedPowerShell(source)];
}

function posixGetCommand(url, timeoutSeconds) {
  return ["/usr/bin/curl", "--fail", "--silent", "--show-error", "--max-time", String(timeoutSeconds), url];
}

function remoteGetArguments(transport, pathName, timeoutSeconds, remotePlatform) {
  const relay = transport.type === "ssh-relay";
  const dashboardPort = relay ? transport.forwardedPort : transport.dashboardPort;
  const url = `http://127.0.0.1:${dashboardPort}${pathName}`;
  const command = !relay && remotePlatform === "windows"
    ? windowsGetCommand(url, timeoutSeconds)
    : posixGetCommand(url, timeoutSeconds);
  return [...sshConnectionArguments(transport), ...command];
}

export function sshSnapshotArguments(transport, { curlTimeoutSeconds = SNAPSHOT_CURL_TIMEOUT_SECONDS, remotePlatform = "posix" } = {}) {
  return remoteGetArguments(transport, "/api/node/snapshot", curlTimeoutSeconds, remotePlatform);
}

export function sshActivityArguments(transport, threadId, { remotePlatform = "posix" } = {}) {
  if (!THREAD_ID_PATTERN.test(String(threadId || ""))) throw new Error("Peer activity thread id is invalid");
  return remoteGetArguments(transport, `/api/node/activity/${encodeURIComponent(threadId)}`, ACTIVITY_CURL_TIMEOUT_SECONDS, remotePlatform);
}

export function sshSkillsArguments(transport, { remotePlatform = "posix" } = {}) {
  return remoteGetArguments(transport, "/api/node/skills", ACTIVITY_CURL_TIMEOUT_SECONDS, remotePlatform);
}

export function sshSkillContentArguments(transport, scope, name, sourceId = scope, { remotePlatform = "posix" } = {}) {
  if (!SKILL_SCOPES.has(scope) || !SKILL_NAME_PATTERN.test(String(name || "")) || !SKILL_SOURCE_PATTERN.test(String(sourceId || ""))) throw new Error("Peer Skill reference is invalid");
  return remoteGetArguments(transport, `/api/node/skills/content?scope=${encodeURIComponent(scope)}&sourceId=${encodeURIComponent(sourceId)}&name=${encodeURIComponent(name)}`, ACTIVITY_CURL_TIMEOUT_SECONDS, remotePlatform);
}

function actionHeader(headers, name, pattern) {
  const value = String(headers[name] || "");
  if (!pattern.test(value)) throw new Error(`Peer action ${name} is invalid`);
  return value;
}

function windowsActionCommand(url, headers) {
  const timestamp = actionHeader(headers, ACTION_HEADERS.timestamp, /^\d{1,20}$/);
  const nonce = actionHeader(headers, ACTION_HEADERS.nonce, /^[A-Za-z0-9_-]{1,128}$/);
  const signature = actionHeader(headers, ACTION_HEADERS.signature, /^[a-f0-9]{64}$/);
  const source = [
    WINDOWS_UTF8_CONSOLE,
    "$ErrorActionPreference='Stop'",
    "$body=[Console]::In.ReadToEnd()",
    "$bodyBytes=$utf8.GetBytes($body)",
    `$headers=@{'${ACTION_HEADERS.timestamp}'='${timestamp}';'${ACTION_HEADERS.nonce}'='${nonce}';'${ACTION_HEADERS.signature}'='${signature}'}`,
    `try{$response=Invoke-WebRequest -UseBasicParsing -TimeoutSec ${ACTION_CURL_TIMEOUT_SECONDS} -Method Post -ContentType 'application/json' -Headers $headers -Body $bodyBytes -Uri '${url}';[Console]::Out.Write($response.Content)}catch{if($_.Exception.Response){$reader=New-Object IO.StreamReader($_.Exception.Response.GetResponseStream());[Console]::Out.Write($reader.ReadToEnd());$reader.Dispose();exit 0};throw}`
  ].join(";");
  return ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedPowerShell(source)];
}

export function sshActionArguments(transport, headers, actionPath = MESSAGE_ACTION_PATH, { remotePlatform = "posix" } = {}) {
  if (!ALLOWED_ACTION_PATHS.has(actionPath)) throw new Error("Peer action path is invalid");
  if (transport.type === "direct-ssh" && remotePlatform === "windows") {
    const url = `http://127.0.0.1:${transport.dashboardPort}${actionPath}`;
    return [...sshConnectionArguments(transport), ...windowsActionCommand(url, headers)];
  }
  const arguments_ = sshSnapshotArguments(transport, { curlTimeoutSeconds: ACTION_CURL_TIMEOUT_SECONDS });
  const url = arguments_.pop().replace("/api/node/snapshot", actionPath);
  const failIndex = arguments_.indexOf("--fail");
  if (failIndex >= 0) arguments_.splice(failIndex, 1);
  arguments_.push(
    "-X", "POST",
    "-H", "content-type:application/json",
    "-H", `${ACTION_HEADERS.timestamp}:${headers[ACTION_HEADERS.timestamp]}`,
    "-H", `${ACTION_HEADERS.nonce}:${headers[ACTION_HEADERS.nonce]}`,
    "-H", `${ACTION_HEADERS.signature}:${headers[ACTION_HEADERS.signature]}`,
    "--data-binary", "@-",
    url
  );
  return arguments_;
}
