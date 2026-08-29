export function isLoopbackHost(host) {
  return host === "127.0.0.1";
}

export function assertLoopbackHost(host, label = "host") {
  if (!isLoopbackHost(host)) {
    throw new Error(`${label} must be exactly 127.0.0.1; received ${host}`);
  }
  return host;
}

export function assertLoopbackUrl(value, label = "URL") {
  const parsed = new URL(value);
  if (parsed.hostname !== "127.0.0.1") {
    throw new Error(`${label} must use 127.0.0.1; received ${parsed.hostname}`);
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
    throw new Error(`${label} uses an unsupported protocol: ${parsed.protocol}`);
  }
  return parsed;
}

export function assertLoopbackConfig(config) {
  assertLoopbackHost(config.dashboardHost, "dashboardHost");
  assertLoopbackHost(config.cdpHost, "cdpHost");
  assertLoopbackUrl(config.dashboardOrigin, "dashboardOrigin");
  assertLoopbackUrl(config.cdpOrigin, "cdpOrigin");
  return config;
}
