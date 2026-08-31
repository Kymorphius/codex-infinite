import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const budget = JSON.parse(fs.readFileSync(path.join(root, "config", "structure-budget.json"), "utf8"));
const supported = new Set([".js", ".mjs", ".css", ".html"]);

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    else if (supported.has(path.extname(entry.name))) files.push(target);
  }
  return files;
}

function category(relative) {
  if (relative.startsWith("test/")) return "test";
  if (relative.startsWith("scripts/")) return "script";
  return "source";
}

const files = ["src", "public", "scripts", "test"].flatMap((directory) => walk(path.join(root, directory)));
const failures = [];
const debt = [];
for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const contents = fs.readFileSync(file);
  const lines = contents.length === 0 ? 0 : contents.toString("utf8").split(/\r?\n/).length - 1 + (contents.at(-1) === 10 ? 0 : 1);
  const limits = budget.fileLimits?.[relative] || budget.frozenDebt[relative] || budget.defaults[category(relative)];
  if (budget.frozenDebt[relative]) debt.push(`${relative} (${lines} lines, ${contents.length} bytes)`);
  if (lines > limits.maxLines || contents.length > limits.maxBytes) {
    failures.push(`${relative}: ${lines}/${limits.maxLines} lines, ${contents.length}/${limits.maxBytes} bytes`);
  }
}

if (failures.length) {
  console.error("structure: budget exceeded\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  console.error("Extract a focused module. Budget increases require an ADR.");
  process.exitCode = 1;
} else {
  console.log(`structure: ok (${files.length} files; ${debt.length} frozen debt files)`);
}
