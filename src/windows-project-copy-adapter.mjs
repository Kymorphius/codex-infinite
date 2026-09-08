import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { isSafeTransferName, normalizeWindowsSourcePath } from "./project-copy-contract.mjs";

const MAX_OUTPUT = 32 * 1024 * 1024;
const MAX_FILES = 50_000;
const MAX_BYTES = 100 * 1024 * 1024 * 1024;
const MAX_SESSION_BYTES = 512 * 1024 * 1024;

const WINDOWS_MANIFEST_SCRIPT = String.raw`
$utf8=[Text.UTF8Encoding]::new($false);[Console]::InputEncoding=$utf8;[Console]::OutputEncoding=$utf8;$OutputEncoding=$utf8
$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop'
$request=[Console]::In.ReadToEnd()|ConvertFrom-Json
$root=[IO.Path]::GetFullPath(([string]$request.sourceDirectory))
if(-not (Test-Path -LiteralPath $root -PathType Container)){throw '源目录不存在'}
$excluded=@{};foreach($name in @($request.exclusions)){$excluded[[string]$name]=$true}
$files=New-Object Collections.Generic.List[object]
$roots=New-Object Collections.Generic.List[object]
$directories=0;$bytes=[int64]0
foreach($entry in @(Get-ChildItem -LiteralPath $root -Force)){
  if($excluded.ContainsKey($entry.Name)){continue}
  if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "不支持重解析点: $($entry.Name)"}
  $roots.Add([pscustomobject]@{name=$entry.Name;directory=[bool]$entry.PSIsContainer})
  $stack=New-Object Collections.Generic.Stack[object];$stack.Push($entry)
  while($stack.Count -gt 0){
    $current=$stack.Pop()
    if($current.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "不支持重解析点: $($current.FullName)"}
    if($current.PSIsContainer){$directories++;foreach($child in @(Get-ChildItem -LiteralPath $current.FullName -Force)){$stack.Push($child)};continue}
    $relative=$current.FullName.Substring($root.Length).TrimStart('\').Replace('\','/')
    $hash=(Get-FileHash -LiteralPath $current.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $bytes+=[int64]$current.Length;$files.Add([pscustomobject]@{path=$relative;bytes=[int64]$current.Length;sha256=$hash})
    if($files.Count -gt ${MAX_FILES} -or $bytes -gt ${MAX_BYTES}){throw '项目超过首版复制上限'}
  }
}
$result=[pscustomobject]@{sourceDirectory=$root;files=@($files|Sort-Object path);rootEntries=@($roots|Sort-Object name);fileCount=$files.Count;directoryCount=$directories;bytes=$bytes;excluded=@($request.exclusions)}
[Console]::Out.Write(($result|ConvertTo-Json -Depth 5 -Compress))
`;

const WINDOWS_SESSION_SCRIPT = String.raw`
$utf8=[Text.UTF8Encoding]::new($false);[Console]::InputEncoding=$utf8;[Console]::OutputEncoding=$utf8;$OutputEncoding=$utf8
$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop'
$request=[Console]::In.ReadToEnd()|ConvertFrom-Json
$roots=@((Join-Path $env:USERPROFILE '.codex\sessions'),(Join-Path $env:USERPROFILE '.codex\archived_sessions'))
$items=@();$total=[int64]0
foreach($id in @($request.threadIds)){
  if(([string]$id) -notmatch '^[0-9a-fA-F-]{36}$'){throw '会话标识无效'}
  $matches=@();foreach($root in $roots){if(Test-Path -LiteralPath $root){$matches+=@(Get-ChildItem -LiteralPath $root -File -Recurse -Filter "*$id*.jsonl")}}
  if($matches.Count -ne 1){throw "无法唯一定位会话: $id"}
  $file=$matches[0];$total+=[int64]$file.Length
  if($total -gt ${MAX_SESSION_BYTES}){throw '项目会话超过首版复制上限'}
  $items+=,[pscustomobject]@{sourceThreadId=([string]$id).ToLowerInvariant();fullPath=$file.FullName;bytes=[int64]$file.Length}
}
$json=[pscustomobject]@{sessions=@($items);bytes=$total}|ConvertTo-Json -Depth 4 -Compress
[Console]::Out.Write([string]$json)
`;

function encodedPowerShell(source) {
  return Buffer.from(source, "utf16le").toString("base64");
}

function directTransport(peer) {
  const transport = peer.transports.find((item) => item.type === "direct-ssh");
  if (!transport) throw new Error("此设备没有可用的直接复制通道");
  return transport;
}

function runProcess(spawnImpl, command, arguments_, input, { timeout = 120_000, maxOutput = MAX_OUTPUT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, arguments_, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let size = 0;
    let stderr = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error("项目复制操作超时")); }, timeout);
    child.stdout.on("data", (chunk) => { size += chunk.length; if (size > maxOutput) child.kill(); else chunks.push(chunk); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-8000); });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (size > maxOutput) finish(new Error("远端项目清单过大"));
      else if (code !== 0) finish(new Error(stderr.trim() || `复制通道退出 ${code}`));
      else finish(null, Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(input);
  });
}

function sshArguments(transport) {
  return ["-o", "BatchMode=yes", "-o", "ConnectTimeout=4", "-o", "StrictHostKeyChecking=yes", "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2", "-p", String(transport.port), `${transport.user}@${transport.host}`];
}

function sftpPath(windowsPath) {
  const normalized = normalizeWindowsSourcePath(windowsPath);
  return `/${normalized[0].toUpperCase()}:${normalized.slice(2).replaceAll("\\", "/")}`;
}

function quoteBatch(value) {
  if (/[\0\r\n"]/.test(value)) throw new Error("复制路径包含暂不支持的字符");
  return `"${value}"`;
}

export class WindowsProjectCopyAdapter {
  constructor({ peer, spawnImpl = nodeSpawn } = {}) {
    this.peer = peer;
    this.spawn = spawnImpl;
  }

  async preflight(sourceDirectory, exclusions = ["target"]) {
    const transport = directTransport(this.peer);
    const args = [...sshArguments(transport), "powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedPowerShell(WINDOWS_MANIFEST_SCRIPT)];
    const stdout = await runProcess(this.spawn, "ssh", args, JSON.stringify({ sourceDirectory, exclusions }));
    let manifest;
    try { manifest = JSON.parse(stdout); } catch { throw new Error("Windows 返回的项目清单无效"); }
    if (!Array.isArray(manifest.files) || !Array.isArray(manifest.rootEntries) || manifest.files.length !== manifest.fileCount) throw new Error("Windows 返回的项目清单不完整");
    if (manifest.rootEntries.some((entry) => !isSafeTransferName(entry.name))) throw new Error("项目包含暂不支持的根目录名称");
    return Object.freeze({ ...manifest, sourceDirectory: normalizeWindowsSourcePath(manifest.sourceDirectory) });
  }

  async download(manifest, stagingDirectory) {
    const transport = directTransport(this.peer);
    await fs.mkdir(stagingDirectory, { recursive: false, mode: 0o700 });
    const source = sftpPath(manifest.sourceDirectory);
    const lines = ["progress"];
    for (const entry of manifest.rootEntries) {
      const remote = quoteBatch(`${source}/${entry.name}`);
      const local = quoteBatch(path.join(stagingDirectory, entry.name));
      lines.push(entry.directory ? `get -R ${remote} ${local}` : `get ${remote} ${local}`);
    }
    const args = ["-q", "-b", "-", "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", "-o", "StrictHostKeyChecking=yes", "-P", String(transport.port), `${transport.user}@${transport.host}`];
    await runProcess(this.spawn, "sftp", args, `${lines.join("\n")}\n`, { timeout: 30 * 60_000, maxOutput: 1024 * 1024 });
  }

  async preflightSessions(threadIds) {
    const transport = directTransport(this.peer);
    const args = [...sshArguments(transport), "powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedPowerShell(WINDOWS_SESSION_SCRIPT)];
    const stdout = await runProcess(this.spawn, "ssh", args, JSON.stringify({ threadIds }));
    let result;
    try { result = JSON.parse(stdout); } catch { throw new Error("Windows 返回的会话清单无效"); }
    if (!Array.isArray(result.sessions) || result.sessions.length !== threadIds.length) throw new Error("Windows 返回的会话清单不完整");
    for (const item of result.sessions) {
      if (!threadIds.includes(item.sourceThreadId) || !normalizeWindowsSourcePath(item.fullPath) || !Number.isSafeInteger(item.bytes) || item.bytes < 0) throw new Error("Windows 返回的会话清单无效");
    }
    return Object.freeze({ sessions: Object.freeze(result.sessions.map(Object.freeze)), bytes: Number(result.bytes) });
  }

  async downloadSessions(manifest, stagingDirectory) {
    const transport = directTransport(this.peer);
    await fs.mkdir(stagingDirectory, { recursive: false, mode: 0o700 });
    const lines = ["progress"];
    for (const item of manifest.sessions) lines.push(`get ${quoteBatch(sftpPath(item.fullPath))} ${quoteBatch(path.join(stagingDirectory, `${item.sourceThreadId}.jsonl`))}`);
    const args = ["-q", "-b", "-", "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", "-o", "StrictHostKeyChecking=yes", "-P", String(transport.port), `${transport.user}@${transport.host}`];
    await runProcess(this.spawn, "sftp", args, `${lines.join("\n")}\n`, { timeout: 10 * 60_000, maxOutput: 1024 * 1024 });
  }
}
