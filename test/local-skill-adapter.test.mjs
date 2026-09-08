import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalSkillAdapter } from "../src/local-skill-adapter.mjs";
import { normalizeSkillPackage, serializeSkillPackage } from "../src/skill-contract.mjs";
import { SkillConfigStore } from "../src/skill-config-store.mjs";

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skills-adapter-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const roots = [{ scope: "codex-user", path: path.join(directory, "codex") }, { scope: "agents-user", path: path.join(directory, "agents") }];
  await fs.mkdir(path.join(roots[0].path, "demo", "scripts"), { recursive: true });
  await fs.writeFile(path.join(roots[0].path, "demo", "SKILL.md"), "---\nname: demo\ndescription: A demo skill\n---\nDo it.\n");
  await fs.writeFile(path.join(roots[0].path, "demo", "scripts", "run.sh"), "echo old\n", { mode: 0o755 });
  return { directory, adapter: new LocalSkillAdapter({ roots, node: { id: "local", name: "Local" } }), roots };
}

test("local Skill discovery exports bounded metadata without filesystem paths", async (t) => {
  const { adapter } = await fixture(t);
  const catalog = await adapter.list();
  assert.equal(catalog.skills.length, 1);
  assert.equal(catalog.skills[0].declaredName, "demo");
  assert.equal(catalog.skills[0].description, "A demo skill");
  assert.equal(JSON.stringify(catalog).includes(os.tmpdir()), false);
  const package_ = await adapter.export("codex-user", "demo");
  assert.equal(package_.files.find((file) => file.path === "scripts/run.sh").executable, true);
});

test("Skill install is hash-guarded, atomic, and backs up replaced content", async (t) => {
  const { adapter, directory, roots } = await fixture(t);
  const original = await adapter.export("codex-user", "demo");
  const replacement = structuredClone(original);
  replacement.files.find((file) => file.path === "scripts/run.sh").content = Buffer.from("echo new\n").toString("base64");
  delete replacement.hash;
  const ready = serializeSkillPackage(normalizeSkillPackage(replacement));
  const result = await adapter.install({ package: ready, expectedCurrentHash: original.hash });
  assert.equal(result.backupCreated, true);
  assert.equal((await fs.readFile(path.join(roots[0].path, "demo", "scripts", "run.sh"), "utf8")), "echo new\n");
  const backups = await fs.readdir(path.join(directory, "skill-sync-backups", "codex-user"));
  assert.equal(backups.length, 1);
  await assert.rejects(adapter.install({ package: original, expectedCurrentHash: original.hash }), /发生变化/);
});

test("linked Skill directories can be shared as sources but are never overwritten", async (t) => {
  const { adapter, directory, roots } = await fixture(t);
  const outside = path.join(directory, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "SKILL.md"), "---\nname: linked\n---\n");
  await fs.symlink(outside, path.join(roots[0].path, "linked"), "dir");
  const linked = (await adapter.list()).skills.find((skill) => skill.name === "linked");
  assert.equal(linked.linked, true);
  const replacement = serializeSkillPackage(normalizeSkillPackage({ scope: "codex-user", name: "linked", files: [{ path: "SKILL.md", content: Buffer.from("changed").toString("base64") }] }));
  await assert.rejects(adapter.install({ package: replacement, expectedCurrentHash: linked.hash }), /目录链接/);
});

test("repository Skills are discovered from indexed projects and exported as personal Skills", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "repo-skills-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const project = path.join(directory, "WorldManager");
  const skillDirectory = path.join(project, ".agents", "skills", "worldmanager-tdd");
  await fs.mkdir(path.join(project, ".git"), { recursive: true });
  await fs.mkdir(skillDirectory, { recursive: true });
  await fs.writeFile(path.join(skillDirectory, "SKILL.md"), "---\nname: worldmanager-tdd\ndescription: Project TDD\n---\n");
  const configStore = new SkillConfigStore({ filePaths: [path.join(directory, ".codex", "config.toml")] });
  const adapter = new LocalSkillAdapter({ roots: [], configStore, projectRootsProvider: async () => [{ cwd: project, projectDisplayName: "WorldManager" }] });
  const catalog = await adapter.list();
  assert.equal(catalog.skills.length, 1);
  assert.equal(catalog.skills[0].scope, "repo");
  assert.equal(catalog.skills[0].projectName, "WorldManager");
  assert.match(catalog.skills[0].sourceId, /^repo-/);
  assert.equal(catalog.skills[0].enabled, true);
  const exported = await adapter.export("repo", "worldmanager-tdd", catalog.skills[0].sourceId);
  assert.equal(exported.scope, "agents-user");
  await adapter.setEnabled({ scope: "repo", sourceId: catalog.skills[0].sourceId, name: "worldmanager-tdd", enabled: false });
  assert.equal((await adapter.list()).skills[0].enabled, false);
});
