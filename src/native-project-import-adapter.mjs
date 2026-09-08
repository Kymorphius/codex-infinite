import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AppServerClient } from "./app-server-client.mjs";

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readSessionMetadata(filePath, expectedId) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const newline = buffer.indexOf(0x0a, 0);
    if (newline < 0 && bytesRead === buffer.length) throw new Error("会话元数据超过导入上限");
    const record = JSON.parse(buffer.subarray(0, newline < 0 ? bytesRead : newline).toString("utf8"));
    const id = String(record?.payload?.id || record?.payload?.session_id || "").toLowerCase();
    const timestamp = String(record?.payload?.timestamp || record?.timestamp || "");
    if (record?.type !== "session_meta" || id !== expectedId || !/^\d{4}-\d{2}-\d{2}T/.test(timestamp)) throw new Error("会话元数据与远端标识不一致");
    return { timestamp, record, bodyOffset: (newline < 0 ? bytesRead : newline + 1) };
  } finally { await handle.close(); }
}

async function cloneSession(sessionRoot, session, destinationDirectory, localThreadId) {
  const { timestamp, record, bodyOffset } = await readSessionMetadata(session.path, session.sourceThreadId);
  const [year, month, day] = timestamp.slice(0, 10).split("-");
  const directory = path.join(sessionRoot, year, month, day);
  const clonedPath = path.join(directory, `rollout-${timestamp.slice(0, 19).replaceAll(":", "-")}-${localThreadId}.jsonl`);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const source = await fs.open(session.path, "r");
  let destination;
  try {
    destination = await fs.open(clonedPath, "wx", 0o600);
    const metadata = {
      ...record,
      payload: {
        ...record.payload,
        id: localThreadId,
        session_id: localThreadId,
        cwd: destinationDirectory,
        thread_source: "codex-control-console-project-copy"
      }
    };
    await destination.write(`${JSON.stringify(metadata)}\n`);
    const buffer = Buffer.alloc(1024 * 1024);
    let position = bodyOffset;
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      await destination.write(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    await destination.sync();
    return clonedPath;
  } catch (error) {
    await fs.rm(clonedPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    await destination?.close().catch(() => {});
    await source.close();
  }
}

export class NativeProjectImportAdapter {
  constructor({ codexPath, codexHome, sessionRoot, sidebarRegistry = null, spawnImpl, timeoutMs = 30_000, idFactory = randomUUID } = {}) {
    this.codexPath = codexPath;
    this.codexHome = codexHome;
    this.sessionRoot = sessionRoot || path.join(codexHome, "sessions");
    this.sidebarRegistry = sidebarRegistry;
    this.spawnImpl = spawnImpl;
    this.timeoutMs = timeoutMs;
    this.idFactory = idFactory;
  }

  async import({ sessions, destinationDirectory, projectName, idempotencyKey }) {
    const created = [];
    try {
      for (const session of sessions) {
        const localThreadId = String(this.idFactory()).toLowerCase();
        if (!THREAD_ID.test(localThreadId)) throw new Error("本机会话标识生成失败");
        const clonedPath = await cloneSession(this.sessionRoot, session, destinationDirectory, localThreadId);
        created.push({ sourceThreadId: session.sourceThreadId, localThreadId, path: clonedPath, title: session.title || null });
      }
    } catch (error) {
      for (const item of created) await fs.rm(item.path, { force: true });
      throw error;
    }
    const client = new AppServerClient({ codexPath: this.codexPath, codexHome: this.codexHome, spawnImpl: this.spawnImpl, timeoutMs: this.timeoutMs });
    try {
      await client.initialize();
      for (const item of created) {
        const indexed = await client.request("thread/read", { threadId: item.localThreadId, includeTurns: false });
        if (path.resolve(String(indexed?.thread?.path || "")) !== path.resolve(item.path)) throw new Error(`本机会话索引路径不一致: ${item.localThreadId}`);
        const title = String(item.title || "").trim().slice(0, 160);
        if (title) await client.request("thread/name/set", { threadId: item.localThreadId, name: title });
      }
      const projects = [];
      let cursor = null;
      do {
        const page = await client.request("project/list", { cursor, limit: 100 });
        projects.push(...(Array.isArray(page?.data) ? page.data : []));
        cursor = page?.nextCursor || null;
      } while (cursor);
      const existing = projects.find((project) => project.roots?.some((root) => root.path === destinationDirectory));
      let projectId = existing?.id || null;
      if (projectId) {
        for (const item of created) await client.request("thread/metadata/update", { threadId: item.localThreadId, projectId });
      } else {
        const imported = await client.request("project/import", { idempotencyKey, name: projectName, roots: [{ path: destinationDirectory }], threads: created.map((item) => item.localThreadId) });
        projectId = imported?.project?.id || imported?.id || null;
      }
      if (!projectId) throw new Error("Codex 没有确认本机项目导入");
      const sectionPage = await client.request("threadSection/list", {});
      const sections = Array.isArray(sectionPage?.data) ? sectionPage.data : Array.isArray(sectionPage?.sections) ? sectionPage.sections : [];
      let collaborationSectionId = sections.find((section) => section?.name === "协同")?.id || null;
      if (!collaborationSectionId) {
        const createdSection = await client.request("threadSection/create", { name: "协同" });
        collaborationSectionId = createdSection?.section?.id || createdSection?.id || null;
      }
      if (!collaborationSectionId) throw new Error("Codex 没有确认协同分组");
      for (const item of created) await client.request("thread/section/move", { threadId: item.localThreadId, sectionId: null });
      const sidebar = await this.sidebarRegistry?.register?.({
        serverProjectId: projectId,
        projectName,
        rootPath: destinationDirectory,
        threadIds: created.map((item) => item.localThreadId),
        collaborationSectionId
      });
      return { projectId, sidebarProjectId: sidebar?.projectId || null, conversations: created.map(({ path: _path, title: _title, ...item }) => item) };
    } catch (error) {
      for (const item of created.toReversed()) await client.request("thread/delete", { threadId: item.localThreadId }).catch(() => {});
      for (const item of created) await fs.rm(item.path, { force: true });
      throw error;
    } finally {
      client.close();
    }
  }
}
