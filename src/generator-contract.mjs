export const GENERATOR_ACTIONS = Object.freeze(["existing_thread", "new_thread"]);
export const MAX_GENERATORS = 100;
export const MAX_GENERATOR_TASKS = 50;
export const MAX_GENERATOR_RUNS = 200;

export function cleanGeneratorText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

export function generatorDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function validateGeneratorTask(input, { idFactory } = {}) {
  const action = GENERATOR_ACTIONS.includes(input?.action) ? input.action : null;
  const title = cleanGeneratorText(input?.title, 160);
  const prompt = cleanGeneratorText(input?.prompt, 12000);
  const project = cleanGeneratorText(input?.project, 200);
  const cwd = cleanGeneratorText(input?.cwd, 2048);
  const targetThreadId = cleanGeneratorText(input?.targetThreadId, 120);
  const targetThreadTitle = cleanGeneratorText(input?.targetThreadTitle, 240);
  if (!action) throw new Error("任务动作无效");
  if (!title) throw new Error("任务标题不能为空");
  if (!prompt) throw new Error("任务消息不能为空");
  if (!project) throw new Error("任务必须选择项目");
  if (!cwd) throw new Error("目标项目没有可验证的工作目录");
  if (action === "existing_thread" && !targetThreadId) throw new Error("必须选择目标对话");
  return {
    id: cleanGeneratorText(input?.id, 120) || idFactory?.(), action, title, prompt, project, cwd,
    targetThreadId: action === "existing_thread" ? targetThreadId : null,
    targetThreadTitle: action === "existing_thread" ? (targetThreadTitle || `对话 ${targetThreadId.slice(0, 8)}`) : "新建会话"
  };
}

export function validateGeneratorInput(input, { now = new Date(), taskIdFactory } = {}) {
  const name = cleanGeneratorText(input?.name, 160);
  if (!name) throw new Error("发生器名称不能为空");
  if (!Array.isArray(input?.tasks) || !input.tasks.length) throw new Error("发生器至少需要一个任务");
  if (input.tasks.length > MAX_GENERATOR_TASKS) throw new Error(`每个发生器最多 ${MAX_GENERATOR_TASKS} 个任务`);
  const scheduledAt = generatorDate(input?.scheduledAt);
  if (input?.scheduledAt && !scheduledAt) throw new Error("触发时间无效");
  if (scheduledAt && new Date(scheduledAt).getTime() <= now.getTime()) throw new Error("触发时间必须晚于当前时间");
  const seen = new Set();
  const tasks = input.tasks.map((task) => {
    const normalized = validateGeneratorTask(task, { idFactory: taskIdFactory });
    if (!normalized.id || seen.has(normalized.id)) throw new Error("任务标识无效或重复");
    seen.add(normalized.id);
    return normalized;
  });
  return { name, scheduledAt, tasks };
}

export function validateManualRequestId(value) {
  const requestId = cleanGeneratorText(value, 120);
  if (!requestId) throw new Error("手动触发请求缺少请求标识");
  return requestId;
}
