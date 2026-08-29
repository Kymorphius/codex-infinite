export function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(payload);
}

export function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function readJsonBody(request, maxBytes = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw httpError(413, "请求内容过大");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw httpError(400, "请求 JSON 无效");
  }
}

export function assertExactMutationOrigin(request, dashboardOrigin) {
  if (request.headers.origin !== dashboardOrigin) throw httpError(403, "需要控制台页面的精确请求来源");
}

export function assertJsonContentType(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().includes("application/json")) {
    throw httpError(415, "请求必须使用 application/json");
  }
}

export function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw httpError(400, "路径标识无效");
  }
}
