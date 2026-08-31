export const MODULES = Object.freeze({
  board: { title: "看板", caption: "任务排期与对话发送" },
  console: { title: "控制台", caption: "只读本机任务记录" },
  sessions: { title: "会话中心", caption: "按工作目录查看原生 Codex 会话" },
  context: { title: "上下文状态", caption: "普通会话使用模型默认窗口；需要时按会话扩展" },
  priority: { title: "项目优先级", caption: "按会话活跃度与运行时间排序" },
  zotero: { title: "文献库", caption: "本机 Zotero 文献与安全回写" }
});

export function createAppState(requestedModule = "board") {
  return {
    module: Object.hasOwn(MODULES, requestedModule) ? requestedModule : "board",
    tasks: [], projects: [], devices: [], dispatches: [],
    taskStatus: "loading", dispatchStatus: "loading",
    context: { initialized: false, status: "loading", items: [] },
    zotero: {
      initialized: false, status: "loading", summary: null, collections: [], items: [],
      total: 0, limit: 24, offset: 0, q: "", collection: "", requestId: 0, writeStatus: null,
      editor: { open: false, mode: "edit", key: "", item: null, pending: null }
    }
  };
}
