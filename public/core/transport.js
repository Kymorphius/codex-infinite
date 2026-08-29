export async function requestJson(url, { method = "GET", body, cache } = {}) {
  const response = await fetch(url, {
    method,
    cache,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
  return data;
}
