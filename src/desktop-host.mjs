import path from "node:path";

const WINDOWS_PACKAGE = "OpenAI.Codex";
const WINDOWS_PROCESS_QUERY = [
  "$items = Get-CimInstance Win32_Process -Filter \"Name='ChatGPT.exe'\" -ErrorAction SilentlyContinue |",
  "  Select-Object ProcessId,ExecutablePath,CommandLine;",
  "if ($items) { $items | ConvertTo-Json -Compress }"
].join(" ");
const WINDOWS_PACKAGE_QUERY = [
  `$package = Get-AppxPackage -Name '${WINDOWS_PACKAGE}' -ErrorAction SilentlyContinue | Select-Object -First 1;`,
  `if (-not $package) { $package = Get-AppxPackage -AllUsers -Name '${WINDOWS_PACKAGE}' -ErrorAction SilentlyContinue | Select-Object -First 1 };`,
  "if (-not $package) { exit 3 };",
  "[Console]::Out.Write($package.InstallLocation)"
].join(" ");

function sameWindowsPath(left, right) {
  return path.win32.normalize(String(left || "")).toLowerCase() === path.win32.normalize(String(right || "")).toLowerCase();
}

function windowsRows(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((row) => {
    const pid = Number(row?.ProcessId);
    const command = String(row?.CommandLine || "").trim();
    const executablePath = String(row?.ExecutablePath || "").trim();
    return Number.isInteger(pid) && command ? [{ pid, command, executablePath }] : [];
  });
}

function macRows(stdout) {
  return String(stdout || "").split(/\n/).flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), command: match[2], executablePath: "" }] : [];
  });
}

export function processSwitchValue(command, name) {
  const marker = `--${name}=`;
  const start = String(command || "").indexOf(marker);
  if (start < 0) return null;
  const valueStart = start + marker.length;
  const source = String(command).slice(valueStart);
  if (source.startsWith('"')) {
    const end = source.indexOf('"', 1);
    return end < 0 ? null : source.slice(1, end);
  }
  const nextSwitch = source.search(/\s+--[a-z0-9-]+(?:=|\s|$)/i);
  return (nextSwitch < 0 ? source : source.slice(0, nextSwitch)).replace(/"$/, "").trim() || null;
}

export async function resolveDesktopExecutable({ config, platform = process.platform, execFileImpl }) {
  if (platform === "darwin") return path.posix.join(config.appPath, "Contents", "MacOS", "ChatGPT");
  if (platform !== "win32") throw new Error(`Unsupported desktop platform: ${platform}`);
  if (config.appPath) {
    return config.appPath.toLowerCase().endsWith(".exe")
      ? config.appPath
      : path.win32.join(config.appPath, "app", "ChatGPT.exe");
  }
  let stdout;
  try {
    ({ stdout } = await execFileImpl("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_PACKAGE_QUERY], { windowsHide: true }));
  } catch {
    throw new Error(`Windows ChatGPT package ${WINDOWS_PACKAGE} is not installed for the current user`);
  }
  const installLocation = String(stdout || "").trim();
  if (!installLocation) throw new Error(`Windows ChatGPT package ${WINDOWS_PACKAGE} has no install location`);
  return path.win32.join(installLocation, "app", "ChatGPT.exe");
}

export async function listDesktopProcesses({ executable, platform = process.platform, execFileImpl }) {
  if (platform === "darwin") {
    const { stdout } = await execFileImpl("/bin/ps", ["-axo", "pid=,command="]);
    return macRows(stdout).filter(({ command }) => command === executable || command.startsWith(`${executable} `));
  }
  if (platform === "win32") {
    const { stdout } = await execFileImpl("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_PROCESS_QUERY], { windowsHide: true });
    return windowsRows(stdout).filter(({ executablePath }) => sameWindowsPath(executablePath, executable));
  }
  throw new Error(`Unsupported desktop platform: ${platform}`);
}

export function desktopSpawnOptions({ environment, platform = process.platform }) {
  return {
    detached: true,
    stdio: "ignore",
    env: environment,
    ...(platform === "win32" ? { windowsHide: false } : {})
  };
}
