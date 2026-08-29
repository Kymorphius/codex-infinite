import os from "node:os";
import path from "node:path";

export const DEFAULT_DASHBOARD_HOST = "127.0.0.1";
export const DEFAULT_DASHBOARD_PORT = 47831;
export const DEFAULT_CDP_HOST = "127.0.0.1";
export const DEFAULT_CDP_PORT = 9231;
export const DEFAULT_APP_PATH = "/Applications/ChatGPT.app";

function integerFromEnv(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}

function positiveIntegerFromEnv(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getConfig(env = process.env, homeDirectory = os.homedir(), platform = process.platform) {
  const dashboardHost = env.CODEX_CONTROL_DASHBOARD_HOST || DEFAULT_DASHBOARD_HOST;
  const cdpHost = env.CODEX_CONTROL_CDP_HOST || DEFAULT_CDP_HOST;
  const dashboardPort = integerFromEnv(env.CODEX_CONTROL_DASHBOARD_PORT, DEFAULT_DASHBOARD_PORT);
  const cdpPort = integerFromEnv(env.CODEX_CONTROL_CDP_PORT, DEFAULT_CDP_PORT);
  const profileDirectory = env.CODEX_CONTROL_PROFILE_DIR || (
    platform === "darwin"
      ? path.join(homeDirectory, "Library", "Application Support", "Codex Control Console")
      : path.join(homeDirectory, ".codex-control-console")
  );
  const sourceCodexHome = env.CODEX_CONTROL_SOURCE_CODEX_HOME || path.join(homeDirectory, ".codex");
  const wrapperCodexHome = env.CODEX_CONTROL_CODEX_HOME || path.join(homeDirectory, ".codex-control-console");
  const wrapperContextWindow = positiveIntegerFromEnv(env.CODEX_CONTROL_CONTEXT_WINDOW, 1_000_000);
  const appPath = env.CODEX_CONTROL_APP_PATH || DEFAULT_APP_PATH;
  const zoteroPath = env.CODEX_CONTROL_ZOTERO_PATH || env.CODEX_CONTROL_ZOTERO_DB_PATH || path.join(homeDirectory, "Zotero", "zotero.sqlite");
  const zoteroLocalApiOrigin = env.CODEX_CONTROL_ZOTERO_LOCAL_API_ORIGIN || env.CODEX_CONTROL_ZOTERO_API_ORIGIN || "http://127.0.0.1:23119/api/";
  const zoteroCredentialPath = path.join(profileDirectory, "zotero-local-api-keys.json");
  const modelCatalogPath = env.CODEX_CONTROL_MODEL_CATALOG_PATH || path.join(sourceCodexHome, "models_cache.json");

  return Object.freeze({
    dashboardHost,
    dashboardPort,
    dashboardOrigin: `http://${dashboardHost}:${dashboardPort}`,
    cdpHost,
    cdpPort,
    cdpOrigin: `http://${cdpHost}:${cdpPort}`,
    profileDirectory,
    sourceCodexHome,
    wrapperCodexHome,
    wrapperContextWindow,
    appPath,
    zoteroPath,
    zoteroLocalApiOrigin,
    zoteroCredentialPath,
    modelCatalogPath,
    sessionRoot: env.CODEX_CONTROL_SESSION_ROOT || path.join(sourceCodexHome, "sessions"),
    archivedSessionRoot: env.CODEX_CONTROL_ARCHIVED_SESSION_ROOT || path.join(sourceCodexHome, "archived_sessions")
  });
}
