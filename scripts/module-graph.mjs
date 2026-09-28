import fs from "node:fs";
import path from "node:path";

// A browser ES module graph fails as a whole when one import is missing: the entry never runs
// and the embedded frame never announces readiness. Resolve the graph statically instead.
const SCRIPT_TAG = /<script\b[^>]*>/gi;
const IMPORT = /(?:^|[;\s])(?:import|export)\s*(?:([\w$*{}\s,]*?)\s*from\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function collectHtml(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collectHtml(target, files);
    else if (entry.name.endsWith(".html")) files.push(target);
  }
  return files;
}

export function moduleEntries(publicRoot) {
  const entries = [];
  for (const html of collectHtml(publicRoot)) {
    for (const [tag] of fs.readFileSync(html, "utf8").matchAll(SCRIPT_TAG)) {
      const src = tag.match(/\bsrc="([^"]+)"/)?.[1];
      if (src && /\btype="module"/.test(tag) && src.startsWith("/")) entries.push({ file: path.join(publicRoot, src), from: path.relative(publicRoot, html) });
    }
  }
  return entries;
}

function exportedNames(source) {
  if (/export\s*\*/.test(source)) return null;
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const item of match[1].split(",")) { const name = item.trim().split(/\s+as\s+/).pop(); if (name) names.add(name); }
  }
  if (/export\s+default\b/.test(source)) names.add("default");
  return names;
}

export function findModuleGraphProblems(publicRoot) {
  const seen = new Set();
  const problems = [];
  const label = file => path.relative(publicRoot, file).split(path.sep).join("/");
  function visit(file, from) {
    if (seen.has(file)) return;
    seen.add(file);
    if (!fs.existsSync(file)) { problems.push(`missing module ${label(file)} (imported by ${from})`); return; }
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT)) {
      const specifier = match[2] || match[3];
      if (!specifier.startsWith("/") && !specifier.startsWith(".")) continue;
      const target = specifier.startsWith("/") ? path.join(publicRoot, specifier) : path.join(path.dirname(file), specifier);
      visit(target, label(file));
      const named = (match[1] || "").match(/\{([^}]*)\}/);
      if (!named || !fs.existsSync(target)) continue;
      const exported = exportedNames(fs.readFileSync(target, "utf8"));
      if (!exported) continue;
      for (const name of named[1].split(",").map(item => item.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
        if (!exported.has(name)) problems.push(`missing export ${name} in ${label(target)} (imported by ${label(file)})`);
      }
    }
  }
  for (const entry of moduleEntries(publicRoot)) visit(entry.file, entry.from);
  return { modules: seen.size, problems };
}
