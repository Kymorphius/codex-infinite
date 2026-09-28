import { ACTION_HEADERS } from "./peer-action-auth.mjs";
import { normalizePeerTransport } from "./peer-contract.mjs";
import { sshSnapshotArguments } from "./ssh-peer-commands.mjs";

export const PROJECT_SYNC_ACTIONS = Object.freeze(["catalog", "inspect", "export", "prepare", "apply", "associate", "dissociate"]);
export const PROJECT_SYNC_NODE_PREFIX = "/api/node/project-sync/";
export const PROJECT_SYNC_SMALL_BODY_BYTES = 8 * 1024;
export const PROJECT_SYNC_PACKAGE_BYTES = 34 * 1024 * 1024;

function signedHeaders(headers) {
  const patterns = [/^\d{1,20}$/, /^[A-Za-z0-9_-]{16,128}$/, /^[a-f0-9]{64}$/];
  return Object.values(ACTION_HEADERS).map((name, index) => {
    const value = String(headers[name] || "");
    if (!patterns[index].test(value)) throw new Error("项目同步签名头无效");
    return [name, value];
  });
}

export function sshProjectSyncArguments(transport, headers, action, { remotePlatform = "posix", timeoutSeconds = 60 } = {}) {
  if (!PROJECT_SYNC_ACTIONS.includes(action)) throw new Error("项目同步操作无效");
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 60) throw new Error("项目同步超时无效");
  transport = normalizePeerTransport(transport);
  const pairs = signedHeaders(headers);
  const args = sshSnapshotArguments(transport, { curlTimeoutSeconds: timeoutSeconds });
  const url = args.pop().replace("/api/node/snapshot", `${PROJECT_SYNC_NODE_PREFIX}${action}`);
  if (transport.type === "direct-ssh" && remotePlatform === "windows") {
    const source = [
      "$utf8=[Text.UTF8Encoding]::new($false);[Console]::InputEncoding=$utf8;[Console]::OutputEncoding=$utf8;$OutputEncoding=$utf8",
      "$ErrorActionPreference='Stop'",
      "$bodyBytes=$utf8.GetBytes([Console]::In.ReadToEnd())",
      `$headers=@{${pairs.map(([name, value]) => `'${name}'='${value}'`).join(";")}}`,
      `try{$response=Invoke-WebRequest -UseBasicParsing -TimeoutSec ${timeoutSeconds} -Method Post -ContentType 'application/json' -Headers $headers -Body $bodyBytes -Uri '${url}';[Console]::Out.Write($response.Content)}catch{if($_.Exception.Response){$reader=New-Object IO.StreamReader($_.Exception.Response.GetResponseStream());[Console]::Out.Write($reader.ReadToEnd());$reader.Dispose();exit 0};throw}`
    ].join(";");
    return [...args.slice(0, args.indexOf("/usr/bin/curl")), "powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(source, "utf16le").toString("base64")];
  }
  args.splice(args.indexOf("--fail"), 1);
  args.push("-X", "POST", "-H", "content-type:application/json");
  for (const [name, value] of pairs) args.push("-H", `${name}:${value}`);
  return [...args, "--data-binary", "@-", url];
}
