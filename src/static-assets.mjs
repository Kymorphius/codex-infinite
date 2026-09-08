import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import packageMetadata from "../package.json" with { type: "json" };

const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const javascriptType = "text/javascript; charset=utf-8";
const coreNames = ["dom", "format", "navigation", "project-priority", "refresh-policy", "state", "tasks", "transport"];
const featureNames = ["runtime", "console", "context", "dispatch", "priority", "sessions", "skills", "turbo", "zotero"];
const dispatchSupportFiles = ["details"];
const skillSupportFiles = ["group-actions"];
const sessionSupportFiles = ["approval-model", "conversation-model", "conversation-tabs", "disclosure", "draft-sync", "execution-view", "markdown-view", "model", "project-copy", "remote-approvals", "remote-conversation", "settings-controller"];
const zoteroSupportFiles = ["browser", "editor", "format"];
const styleNames = ["base", "tasks", "sessions-priority", "approvals", "execution", "conversation", "states", "zotero", "theme", "turbo", "skills", "responsive"];
const panelFiles = ["board", "context", "console", "sessions", "priority", "skills", "zotero"].map((name) => `panels/${name}.html`);
const assetMap = new Map([
  ["/restart.html", { file: "restart.html", type: "text/html; charset=utf-8" }],
  ["/features/runtime/sidebar.js", { file: "features/runtime/sidebar.js", type: javascriptType }],
  ["/", { file: "index.html", fragments: panelFiles, type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", fragments: panelFiles, type: "text/html; charset=utf-8" }],
  ...styleNames.map((name) => [`/styles/${name}.css`, { file: `styles/${name}.css`, type: "text/css; charset=utf-8" }]),
  ["/app.js", { file: "app.js", type: javascriptType }],
  ["/theme.js", { file: "theme.js", type: javascriptType }],
  ...coreNames.map((name) => [`/core/${name}.js`, { file: `core/${name}.js`, type: javascriptType }]),
  ...featureNames.map((name) => [`/features/${name}/index.js`, { file: `features/${name}/index.js`, type: javascriptType }]),
  ...dispatchSupportFiles.map((name) => [`/features/dispatch/${name}.js`, { file: `features/dispatch/${name}.js`, type: javascriptType }]),
  ...skillSupportFiles.map((name) => [`/features/skills/${name}.js`, { file: `features/skills/${name}.js`, type: javascriptType }]),
  ...sessionSupportFiles.map((name) => [`/features/sessions/${name}.js`, { file: `features/sessions/${name}.js`, type: javascriptType }]),
  ...zoteroSupportFiles.map((name) => [`/features/zotero/${name}.js`, { file: `features/zotero/${name}.js`, type: javascriptType }])
].map(([url, asset]) => [url, Object.freeze({
  ...asset,
  path: path.join(publicDirectory, asset.file),
  fragmentPaths: Object.freeze((asset.fragments || []).map((file) => path.join(publicDirectory, file)))
})]));

export const STATIC_ASSET_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'";
export const CONTROL_CONSOLE_VERSION = /^[0-9A-Za-z.+-]{1,32}$/.test(packageMetadata.version) ? packageMetadata.version : "unknown";

function rawPathname(target) {
  const value = String(target || "/");
  return value.slice(0, [value.indexOf("?"), value.indexOf("#")].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? value.length);
}

function containsDotSegment(pathname) {
  try {
    return decodeURIComponent(pathname).split("/").some((segment) => segment === "." || segment === "..");
  } catch {
    return true;
  }
}

export function resolveStaticAsset(target) {
  const pathname = rawPathname(target);
  if (!pathname.startsWith("/") || containsDotSegment(pathname)) return null;
  return assetMap.get(pathname) || null;
}

export function composeHtml(shell, fragments) {
  const marker = "<!-- MODULE_PANELS -->";
  const versionMarker = "<!-- CONTROL_CONSOLE_VERSION -->";
  const source = String(shell);
  const first = source.indexOf(marker);
  if (first < 0 || first !== source.lastIndexOf(marker)) throw new Error("Static HTML shell must contain exactly one module marker");
  if (source.indexOf(versionMarker) < 0 || source.indexOf(versionMarker) !== source.lastIndexOf(versionMarker)) throw new Error("Static HTML shell must contain exactly one version marker");
  return source.replace(marker, fragments.map(String).join("\n")).replace(versionMarker, `v${CONTROL_CONSOLE_VERSION}`);
}

async function readAssetContent(asset, readFile) {
  const content = await readFile(asset.path);
  if (!asset.fragmentPaths.length) return content;
  const fragments = await Promise.all(asset.fragmentPaths.map((file) => readFile(file)));
  return Buffer.from(composeHtml(content, fragments));
}

export async function serveStaticAsset(request, response, { readFile = fs.readFile } = {}) {
  const asset = resolveStaticAsset(request.url);
  if (!asset) return false;
  const content = request.method === "HEAD" ? null : await readAssetContent(asset, readFile);
  response.writeHead(200, {
    "content-type": asset.type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": STATIC_ASSET_CSP
  });
  if (request.method === "HEAD") response.end();
  else response.end(content);
  return true;
}
