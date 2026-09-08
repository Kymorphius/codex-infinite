import os from "node:os";
import path from "node:path";

export const DEFAULT_DASHBOARD_HOST = "127.0.0.1";
export const DEFAULT_DASHBOARD_PORT = 47831;
export const DEFAULT_CDP_HOST = "127.0.0.1";
export const DEFAULT_CDP_PORT = 9231;
export const DEFAULT_PRIMARY_CDP_PORT = 9232;
export const DEFAULT_APP_PATH = "/Applications/ChatGPT.app";

function integerFromEnv(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}

function positiveIntegerFromEnv(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanFromEnv(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

export function getConfig(env = process.env, homeDirectory = os.homedir(), platform = process.platform) {
  const hostPath = platform === "win32" ? path.win32 : path.posix;
  const dashboardHost = env.CODEX_CONTROL_DASHBOARD_HOST || DEFAULT_DASHBOARD_HOST;
  const cdpHost = env.CODEX_CONTROL_CDP_HOST || DEFAULT_CDP_HOST;
  const dashboardPort = integerFromEnv(env.CODEX_CONTROL_DASHBOARD_PORT, DEFAULT_DASHBOARD_PORT);
  const cdpPort = integerFromEnv(env.CODEX_CONTROL_CDP_PORT, DEFAULT_CDP_PORT);
  const primaryCdpHost = env.CODEX_CONTROL_PRIMARY_CDP_HOST || DEFAULT_CDP_HOST;
  const primaryCdpPort = integerFromEnv(env.CODEX_CONTROL_PRIMARY_CDP_PORT, DEFAULT_PRIMARY_CDP_PORT);
  const primaryCdpEnabled = booleanFromEnv(env.CODEX_CONTROL_PRIMARY_CDP_ENABLED);
  const cspReloadRequired = true;
  const localAppData = env.LOCALAPPDATA || hostPath.join(homeDirectory, "AppData", "Local");
  const profileDirectory = env.CODEX_CONTROL_PROFILE_DIR || (
    platform === "darwin"
      ? hostPath.join(homeDirectory, "Library", "Application Support", "Codex Control Console")
      : platform === "win32"
        ? hostPath.join(localAppData, "Codex Control Console", "Profile")
        : hostPath.join(homeDirectory, ".codex-control-console")
  );
  const sourceCodexHome = env.CODEX_CONTROL_SOURCE_CODEX_HOME || hostPath.join(homeDirectory, ".codex");
  const primaryProfileDirectory = env.CODEX_CONTROL_PRIMARY_PROFILE_DIR || (
    platform === "darwin"
      ? hostPath.join(homeDirectory, "Library", "Application Support", "Codex")
      : platform === "win32"
        ? hostPath.join(localAppData, "Packages", "OpenAI.Codex_2p2nqsd0c76g0", "LocalCache", "Roaming", "Codex", "web", "Codex")
        : hostPath.join(homeDirectory, ".config", "Codex")
  );
  const wrapperCodexHome = env.CODEX_CONTROL_CODEX_HOME || hostPath.join(homeDirectory, ".codex-control-console");
  const nativeCodexHome = platform === "win32" ? sourceCodexHome : wrapperCodexHome;
  const perThreadContextWindow = positiveIntegerFromEnv(env.CODEX_CONTROL_CONTEXT_WINDOW, 1_000_000);
  const appPath = env.CODEX_CONTROL_APP_PATH || (platform === "darwin" ? DEFAULT_APP_PATH : "");
  const codexPath = env.CODEX_CONTROL_CODEX_PATH || (
    platform === "darwin"
      ? hostPath.join(appPath, "Contents", "Resources", "codex")
      : platform === "win32"
        ? hostPath.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe")
        : "codex"
  );
  const zoteroPath = env.CODEX_CONTROL_ZOTERO_PATH || env.CODEX_CONTROL_ZOTERO_DB_PATH || hostPath.join(homeDirectory, "Zotero", "zotero.sqlite");
  const zoteroLocalApiOrigin = env.CODEX_CONTROL_ZOTERO_LOCAL_API_ORIGIN || env.CODEX_CONTROL_ZOTERO_API_ORIGIN || "http://127.0.0.1:23119/api/";
  const zoteroCredentialPath = hostPath.join(profileDirectory, "zotero-local-api-keys.json");
  const modelCatalogPath = env.CODEX_CONTROL_MODEL_CATALOG_PATH || hostPath.join(sourceCodexHome, "models_cache.json");
  const hostname = os.hostname() || "本机";
  const nodeDevice = Object.freeze({
    id: env.CODEX_CONTROL_NODE_ID || `local:${hostname}`,
    name: env.CODEX_CONTROL_NODE_NAME || hostname,
    kind: "local-codex",
    location: env.CODEX_CONTROL_NODE_LOCATION || "本机",
    status: "connected"
  });
  const peerConfigPath = env.CODEX_CONTROL_PEER_CONFIG || hostPath.join(wrapperCodexHome, "peers.json");
  const nodeActionKeyPath = env.CODEX_CONTROL_NODE_ACTION_KEY || hostPath.join(wrapperCodexHome, "node-action.key");
  const peerActionKeyDirectory = env.CODEX_CONTROL_PEER_ACTION_KEY_DIR || hostPath.join(wrapperCodexHome, "peer-keys");
  const projectCopyRoots = String(env.CODEX_CONTROL_PROJECT_COPY_ROOTS || hostPath.join(homeDirectory, "333.dev"))
    .split(path.delimiter).map((value) => value.trim()).filter(Boolean).map((value) => hostPath.resolve(value));

  return Object.freeze({
    dashboardHost,
    dashboardPort,
    dashboardOrigin: `http://${dashboardHost}:${dashboardPort}`,
    cdpHost,
    cdpPort,
    cdpOrigin: `http://${cdpHost}:${cdpPort}`,
    primaryCdpHost,
    primaryCdpPort,
    primaryCdpOrigin: `http://${primaryCdpHost}:${primaryCdpPort}`,
    primaryCdpEnabled,
    cspReloadRequired,
    primaryProfileDirectory,
    profileDirectory,
    userHome: homeDirectory,
    sourceCodexHome,
    wrapperCodexHome,
    nativeCodexHome,
    perThreadContextWindow,
    appPath,
    codexPath,
    zoteroPath,
    zoteroLocalApiOrigin,
    zoteroCredentialPath,
    modelCatalogPath,
    threadStateDatabasePath: env.CODEX_CONTROL_THREAD_STATE_DB || hostPath.join(sourceCodexHome, "state_5.sqlite"),
    sessionTitleIndexPath: env.CODEX_CONTROL_SESSION_TITLE_INDEX || path.join(sourceCodexHome, "session_index.jsonl"),
    nodeDevice,
    peerConfigPath,
    nodeActionKeyPath,
    peerActionKeyDirectory,
    projectCopyRoots: Object.freeze(projectCopyRoots),
    sessionRoot: env.CODEX_CONTROL_SESSION_ROOT || path.join(sourceCodexHome, "sessions"),
    archivedSessionRoot: env.CODEX_CONTROL_ARCHIVED_SESSION_ROOT || path.join(sourceCodexHome, "archived_sessions")
  });
}
