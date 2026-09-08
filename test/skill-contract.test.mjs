import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSkillCatalog, normalizeSkillPackage, serializeSkillPackage, skillPackageHash } from "../src/skill-contract.mjs";

const encoded = (value) => Buffer.from(value).toString("base64");

test("Skill packages use deterministic cross-platform path and content hashes", () => {
  const left = normalizeSkillPackage({ scope: "codex-user", name: "demo", files: [
    { path: "scripts/run.sh", executable: true, content: encoded("echo ok") },
    { path: "SKILL.md", executable: false, content: encoded("---\nname: demo\ndescription: Demo\n---\n") }
  ] });
  const right = normalizeSkillPackage({ scope: "codex-user", name: "demo", files: [...serializeSkillPackage(left).files].reverse(), hash: left.hash });
  assert.equal(left.hash, right.hash);
  assert.equal(skillPackageHash(left.files), right.hash);
  assert.equal(normalizeSkillPackage({ scope: "codex-user", name: "demo", files: serializeSkillPackage(left).files.map((file) => ({ ...file, executable: false })) }).hash, left.hash);
});

test("Skill contracts reject traversal, links represented as paths, oversized catalogs, and forged hashes", () => {
  assert.throws(() => normalizeSkillPackage({ scope: "codex-user", name: "demo", files: [{ path: "../SKILL.md", content: encoded("x") }] }), /路径/);
  assert.throws(() => normalizeSkillPackage({ scope: "codex-user", name: "demo", files: [{ path: "SKILL.md", content: encoded("x") }], hash: "0".repeat(64) }), /指纹/);
  assert.throws(() => normalizeSkillPackage({ scope: "codex-user", name: "demo", files: Array.from({ length: 129 }, (_, index) => ({ path: index ? `file-${index}` : "SKILL.md", content: "" })) }), /数量/);
  assert.throws(() => normalizeSkillCatalog({ schemaVersion: 2, skills: Array.from({ length: 257 }, () => ({})) }), /清单/);
  assert.throws(() => normalizeSkillPackage({ scope: "repo", name: "demo", files: [{ path: "SKILL.md", content: encoded("x") }] }), /安装范围/);
});
