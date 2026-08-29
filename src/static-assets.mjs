import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const javascriptType = "text/javascript; charset=utf-8";
const featureNames = ["console", "context", "dispatch", "priority", "sessions"];
const assetMap = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: javascriptType }],
  ["/core/transport.js", { file: "core/transport.js", type: javascriptType }],
  ...featureNames.map((name) => [`/features/${name}/index.js`, { file: `features/${name}/index.js`, type: javascriptType }])
].map(([url, asset]) => [url, Object.freeze({ ...asset, path: path.join(publicDirectory, asset.file) })]));

export const STATIC_ASSET_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'";

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

export async function serveStaticAsset(request, response, { readFile = fs.readFile } = {}) {
  const asset = resolveStaticAsset(request.url);
  if (!asset) return false;
  const content = await readFile(asset.path);
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
