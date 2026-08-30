import fs from "node:fs/promises";
import path from "node:path";

const STATE_FILE = ".codex-global-state.json";
const LOCAL_PROJECTS = "local-projects";
const PROJECT_MAPPINGS = "app-server-project-id-by-legacy-project-id-by-host";
const PROJECT_MIGRATIONS = "app-server-projects-migration-by-host";
const SELECTED_PROJECT = "selected-project";
const WORKSPACE_ROOTS = "electron-saved-workspace-roots";
const WORKSPACE_LABELS = "electron-workspace-root-labels";

async function readState(filePath, { optional = false } = {}) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (optional && error.code === "ENOENT") return {};
    throw new Error(`无法读取 Codex 项目状态 ${filePath}: ${error.message}`);
  }
}

async function writeState(filePath, state) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
  await fs.chmod(filePath, 0o600);
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function mergeWrapperProjectState(source, target, { sourceHome, wrapperHome }) {
  const sourceProjects = record(source[LOCAL_PROJECTS]);
  if (Object.keys(sourceProjects).length === 0) return { changed: false, state: target };
  const state = structuredClone(target);
  const targetProjects = record(state[LOCAL_PROJECTS]);
  const mergedProjects = { ...targetProjects, ...sourceProjects };
  let changed = JSON.stringify(mergedProjects) !== JSON.stringify(targetProjects);
  state[LOCAL_PROJECTS] = mergedProjects;

  const sourceHost = `local:${path.resolve(sourceHome)}`;
  const wrapperHost = `local:${path.resolve(wrapperHome)}`;
  const sourceMappings = record(record(source[PROJECT_MAPPINGS])[sourceHost]);
  if (Object.keys(sourceMappings).length > 0) {
    const allMappings = record(state[PROJECT_MAPPINGS]);
    const targetMappings = record(allMappings[wrapperHost]);
    const mergedMappings = { ...targetMappings, ...sourceMappings };
    changed ||= JSON.stringify(mergedMappings) !== JSON.stringify(targetMappings);
    state[PROJECT_MAPPINGS] = { ...allMappings, [wrapperHost]: mergedMappings };
  }

  const sourceMigration = record(source[PROJECT_MIGRATIONS])[sourceHost];
  if (sourceMigration) {
    const migrations = record(state[PROJECT_MIGRATIONS]);
    if (JSON.stringify(migrations[wrapperHost]) !== JSON.stringify(sourceMigration)) changed = true;
    state[PROJECT_MIGRATIONS] = { ...migrations, [wrapperHost]: sourceMigration };
  }
  if (state[SELECTED_PROJECT] == null && source[SELECTED_PROJECT] != null) {
    state[SELECTED_PROJECT] = source[SELECTED_PROJECT];
    changed = true;
  }
  for (const key of [WORKSPACE_ROOTS, WORKSPACE_LABELS]) {
    if (state[key] == null && source[key] != null) {
      state[key] = source[key];
      changed = true;
    }
  }
  return { changed, state };
}

export async function repairWrapperProjectState({ sourceHome, wrapperHome }) {
  const sourcePath = path.join(sourceHome, STATE_FILE);
  const wrapperPath = path.join(wrapperHome, STATE_FILE);
  const source = await readState(sourcePath, { optional: true });
  const target = await readState(wrapperPath, { optional: true });
  const result = mergeWrapperProjectState(source, target, { sourceHome, wrapperHome });
  if (!result.changed) return { changed: false, projectCount: Object.keys(record(target[LOCAL_PROJECTS])).length };
  await writeState(wrapperPath, result.state);
  return { changed: true, projectCount: Object.keys(record(result.state[LOCAL_PROJECTS])).length };
}

export async function orderWrapperProjectState({ wrapperHome, serverProjectIds }) {
  const wrapperPath = path.join(wrapperHome, STATE_FILE);
  const state = await readState(wrapperPath, { optional: true });
  const projects = record(state[LOCAL_PROJECTS]);
  const entries = Object.entries(projects);
  if (entries.length === 0) return { changed: false, projectCount: 0 };
  const wrapperHost = `local:${path.resolve(wrapperHome)}`;
  const mappings = record(record(state[PROJECT_MAPPINGS])[wrapperHost]);
  const ranks = new Map((serverProjectIds || []).map((id, index) => [id, index]));
  const ordered = entries.map(([id, project], index) => ({ id, project, index, rank: ranks.get(mappings[id]) }));
  ordered.sort((left, right) => (
    (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER)
    || left.index - right.index
  ));
  const orderedProjects = Object.fromEntries(ordered.map(({ id, project }) => [id, project]));
  const changed = ordered.some((entry, index) => entry.id !== entries[index][0]);
  if (!changed) return { changed: false, projectCount: entries.length };
  state[LOCAL_PROJECTS] = orderedProjects;
  await writeState(wrapperPath, state);
  return { changed: true, projectCount: entries.length };
}
