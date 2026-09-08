import { buildNativeProjectOrder, projectMovePlan } from "./project-order.mjs";
import { AppServerClient } from "./app-server-client.mjs";

export class AppServerProjectOrder {
  constructor({ codexPath, codexHome, spawnImpl, logger = console, timeoutMs } = {}) {
    this.codexPath = codexPath;
    this.codexHome = codexHome;
    this.spawnImpl = spawnImpl;
    this.logger = logger;
    this.timeoutMs = timeoutMs;
  }

  async apply(tasks, now = new Date()) {
    const client = new AppServerClient({
      codexPath: this.codexPath,
      codexHome: this.codexHome,
      spawnImpl: this.spawnImpl,
      timeoutMs: this.timeoutMs
    });
    try {
      await client.initialize();
      const projects = [];
      let cursor = null;
      do {
        const page = await client.request("project/list", { cursor, limit: 100 });
        if (!Array.isArray(page?.data)) throw new Error("Codex 返回了无效的项目列表");
        projects.push(...page.data);
        cursor = page.nextCursor || null;
      } while (cursor);
      const ordered = buildNativeProjectOrder(projects, tasks, now);
      const moves = projectMovePlan(projects, ordered);
      for (const move of moves) await client.request("project/move", move);
      return {
        changed: moves.length > 0,
        projectCount: projects.length,
        moveCount: moves.length,
        order: ordered.map(({ project, score }) => ({ id: project.id, name: project.name, priorityScore: score?.priorityScore ?? null }))
      };
    } finally {
      client.close();
    }
  }
}
