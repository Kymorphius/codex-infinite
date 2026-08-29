import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directories = ["src", "scripts", "test", "public"];
const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(target);
    else if (entry.name.endsWith(".mjs") || entry.name.endsWith(".js")) files.push(target);
  }
}
for (const directory of directories) collect(path.join(root, directory));
for (const file of files) execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
console.log(`check: syntax ok (${files.length} files)`);
