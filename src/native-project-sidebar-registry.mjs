import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const STATE_FILE = ".codex-global-state.json";
const LOCAL_PROJECTS = "local-projects";
const PROJECT_MAPPINGS = "app-server-project-id-by-legacy-project-id-by-host";
const THREAD_ASSIGNMENTS = "thread-project-assignments";
const PERSISTED_ATOMS = "electron-persisted-atom-state";
const CUSTOM_SECTIONS = "sidebar-custom-sections-v3";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function readState(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`无法读取 Codex 项目状态 ${filePath}: ${error.message}`);
  }
}

async function writeState(filePath, state) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
  await fs.chmod(filePath, 0o600);
}

function normalizedRoot(value) {
  return path.resolve(String(value || ""));
}

export function registerNativeSidebarProjectState(state, { codexHome, serverProjectId, projectName, rootPath, threadIds, collaborationSectionId = null, now = Date.now(), legacyProjectId = crypto.randomUUID(), sectionProfileId = crypto.randomUUID() }) {
  const projects = record(state[LOCAL_PROJECTS]);
  const root = normalizedRoot(rootPath);
  const existing = Object.values(projects).find((project) => (
    Array.isArray(project?.rootPaths) && project.rootPaths.some((candidate) => normalizedRoot(candidate) === root)
  ));
  const projectId = String(existing?.id || legacyProjectId);
  const next = structuredClone(state);
  next[LOCAL_PROJECTS] = { ...projects, [projectId]: {
    ...record(existing), id: projectId, name: String(projectName), rootPaths: [root],
    createdAt: existing?.createdAt || now, updatedAt: now
  } };
  const host = `local:${normalizedRoot(codexHome)}`;
  const mappingsByHost = record(next[PROJECT_MAPPINGS]);
  next[PROJECT_MAPPINGS] = {
    ...mappingsByHost,
    [host]: { ...record(mappingsByHost[host]), [projectId]: String(serverProjectId) }
  };
  const assignments = record(next[THREAD_ASSIGNMENTS]);
  next[THREAD_ASSIGNMENTS] = { ...assignments };
  for (const threadId of threadIds || []) {
    next[THREAD_ASSIGNMENTS][String(threadId)] = { projectKind: "local", projectId };
  }
  if (collaborationSectionId) {
    const atoms = record(next[PERSISTED_ATOMS]);
    const accounts = record(atoms[CUSTOM_SECTIONS]);
    const updatedAccounts = {};
    for (const [accountId, value] of Object.entries(accounts)) {
      const profile = record(value);
      const directThreadKeys = new Set((threadIds || []).map((id) => `codex:thread:local:${id}`));
      const sections = (Array.isArray(profile.sections) ? profile.sections : []).map((section) => ({
        ...section,
        itemKeys: (Array.isArray(section?.itemKeys) ? section.itemKeys : []).filter((key) => !directThreadKeys.has(key))
      }));
      let collaboration = sections.find((section) => section?.name === "协同");
      if (!collaboration) {
        collaboration = { id: sectionProfileId, name: "协同", hostSectionIds: { local: collaborationSectionId }, itemKeys: [], appearance: null };
        sections.push(collaboration);
      }
      collaboration.hostSectionIds = { ...record(collaboration.hostSectionIds), local: collaborationSectionId };
      const projectKey = `codex:project:${projectId}`;
      collaboration.itemKeys = [projectKey, ...collaboration.itemKeys.filter((key) => key !== projectKey)];
      const customKey = `custom:${collaboration.id}`;
      const order = (Array.isArray(profile.sectionOrder) ? profile.sectionOrder : []).filter((key) => key !== customKey);
      const threadsIndex = order.indexOf("threads");
      order.splice(threadsIndex < 0 ? order.length : threadsIndex, 0, customKey);
      updatedAccounts[accountId] = {
        ...profile,
        sections,
        collapsedSectionIds: (Array.isArray(profile.collapsedSectionIds) ? profile.collapsedSectionIds : []).filter((id) => id !== collaboration.id),
        sectionOrder: order
      };
    }
    next[PERSISTED_ATOMS] = { ...atoms, [CUSTOM_SECTIONS]: updatedAccounts };
  }
  return { state: next, projectId };
}

export class NativeProjectSidebarRegistry {
  constructor({ homes = [], now = () => Date.now(), randomUUID = () => crypto.randomUUID() } = {}) {
    this.homes = [...new Set(homes.map((home) => normalizedRoot(home)))];
    this.now = now;
    this.randomUUID = randomUUID;
  }

  async register({ serverProjectId, projectName, rootPath, threadIds = [], collaborationSectionId = null }) {
    let legacyProjectId = this.randomUUID();
    const sectionProfileId = this.randomUUID();
    for (const codexHome of this.homes) {
      const filePath = path.join(codexHome, STATE_FILE);
      const state = await readState(filePath);
      const result = registerNativeSidebarProjectState(state, {
        codexHome, serverProjectId, projectName, rootPath, threadIds,
        collaborationSectionId, now: this.now(), legacyProjectId, sectionProfileId
      });
      legacyProjectId = result.projectId;
      await writeState(filePath, result.state);
    }
    return { projectId: legacyProjectId };
  }
}
