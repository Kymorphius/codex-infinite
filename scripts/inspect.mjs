import fs from "node:fs/promises";
import { getConfig } from "../src/config.mjs";
import { CdpConnection, chooseMainTarget, discoverTargets } from "../src/cdp-client.mjs";

const config = getConfig();
const targets = await discoverTargets(config.cdpOrigin);
const target = chooseMainTarget(targets);
const connection = new CdpConnection(target.webSocketDebuggerUrl, { commandTimeoutMs: 20000 });
await connection.connect();
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const waitForDashboardReady = async () => {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const ready = await connection.evaluate("Boolean(document.querySelector('[data-codex-control-console-frame-ready]'))").catch(() => false);
    if (ready) return true;
    await wait(250);
  }
  return false;
};
const waitForDashboardData = async () => {
  await waitForDashboardReady();
  let iframeTarget = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    iframeTarget = (await discoverTargets(config.cdpOrigin)).find((candidate) => (
      candidate.type === "iframe" && candidate.url?.startsWith(`${config.dashboardOrigin}/`)
    ));
    if (iframeTarget) break;
    await wait(250);
  }
  if (!iframeTarget) return false;
  const { sessionId } = await connection.send("Target.attachToTarget", { targetId: iframeTarget.id, flatten: true });
  try {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const loaded = await evaluateInSession(sessionId, `(() => {
        const module = new URLSearchParams(location.search).get('module') || 'board';
        const selector = module === 'console' ? '[data-testid="console-connection-status"]' : module === 'sessions' ? '[data-testid="session-connection-status"]' : module === 'priority' ? '[data-testid="priority-connection-status"]' : '[data-testid="connection-status"]';
        const text = document.querySelector(selector)?.textContent?.trim() || '';
        return text && text !== '连接中…';
      })()`).catch(() => false);
      if (loaded) return true;
      await wait(250);
    }
    return false;
  } finally {
    await connection.send("Target.detachFromTarget", { sessionId }).catch(() => {});
  }
};
const evaluateInSession = async (sessionId, expression) => {
  const result = await connection.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  }, sessionId);
  if (result?.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.description || result.exceptionDetails.text || "Runtime.evaluate failed";
    throw new Error(detail);
  }
  return result?.result?.value;
};
const clickHostSelector = async (selector) => {
  const point = await connection.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Clickable element is not present: ${selector}`);
  await connection.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await connection.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await connection.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
};
if (process.argv.includes("--reload")) {
  await connection.send("Page.reload", { ignoreCache: true });
  await wait(1800);
}
if (process.argv.includes("--open-console")) {
  let entryReady = false;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    entryReady = await connection.evaluate("Boolean(document.querySelector('[data-codex-control-console-entry]'))");
    if (entryReady) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await connection.evaluate(`(() => {
    const entry = document.querySelector('[data-codex-control-console-entry]');
    if (!entry) throw new Error('控制台 entry is not present');
    entry.click();
    return true;
  })()`);
  await waitForDashboardData();
}
if (process.argv.includes("--open-kanban")) {
  await connection.evaluate("window.__codexControlConsoleClose?.()");
  await wait(250);
  let kanbanEntryReady = false;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    kanbanEntryReady = await connection.evaluate("Boolean(document.querySelector('[data-codex-control-console-kanban-entry]'))");
    if (kanbanEntryReady) break;
    await wait(300);
  }
  await connection.evaluate(`(() => {
    const entry = document.querySelector('[data-codex-control-console-kanban-entry]');
    if (!entry) throw new Error('看板 entry is not present');
    entry.click();
    return true;
  })()`);
  await waitForDashboardData();
}
if (process.argv.includes("--open-sessions")) {
  await connection.evaluate("window.__codexControlConsoleClose?.()");
  await wait(250);
  let sessionEntryReady = false;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    sessionEntryReady = await connection.evaluate("Boolean(document.querySelector('[data-codex-control-console-session-entry]'))");
    if (sessionEntryReady) break;
    await wait(300);
  }
  await connection.evaluate(`(() => {
    const entry = document.querySelector('[data-codex-control-console-session-entry]');
    if (!entry) throw new Error('会话中心 entry is not present');
    entry.click();
    return true;
  })()`);
  await waitForDashboardData();
}
if (process.argv.includes("--open-priority")) {
  await connection.evaluate("window.__codexControlConsoleClose?.()");
  await wait(250);
  let priorityEntryReady = false;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    priorityEntryReady = await connection.evaluate("Boolean(document.querySelector('[data-codex-control-console-priority-entry]'))");
    if (priorityEntryReady) break;
    await wait(300);
  }
  await connection.evaluate(`(() => {
    const entry = document.querySelector('[data-codex-control-console-priority-entry]');
    if (!entry) throw new Error('项目优先级 entry is not present');
    entry.click();
    return true;
  })()`);
  await waitForDashboardData();
}
let filterEvidence = null;
if (process.argv.includes("--exercise-filters")) {
  let iframeTarget = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    iframeTarget = (await discoverTargets(config.cdpOrigin)).find((candidate) => (
      candidate.type === "iframe" && candidate.url?.startsWith(`${config.dashboardOrigin}/`)
    ));
    if (iframeTarget) break;
    await wait(250);
  }
  if (!iframeTarget) {
    filterEvidence = { status: "dashboard-iframe-unavailable" };
  } else {
    const { sessionId } = await connection.send("Target.attachToTarget", { targetId: iframeTarget.id, flatten: true });
    filterEvidence = await evaluateInSession(sessionId, `(async () => {
      const select = document.querySelector('[data-testid="project-filter"]');
      if (!select) return { status: "project-filter-unavailable" };
      const options = Array.from(select.options).map((option) => ({ value: option.value, label: option.textContent }));
      const choices = options.filter((option) => option.value !== 'all').slice(0, 2);
      const boardSnapshot = () => ({
        cards: document.querySelectorAll('[data-testid="board-grid"] article[data-task-id]').length,
        columns: Object.fromEntries(Array.from(document.querySelectorAll('[data-board-column]')).map((column) => [
          column.dataset.boardColumn,
          Number(column.querySelector('.column-count')?.textContent || 0)
        ]))
      });
      const samples = [];
      for (const option of choices) {
        select.focus();
        select.click();
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 100));
        samples.push({ project: option.label, value: option.value, ...boardSnapshot() });
      }
      select.focus();
      select.click();
      select.value = 'all';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { status: choices.length >= 2 ? 'verified' : 'not-enough-projects', options, samples, allProjects: boardSnapshot() };
    })()`);
    await connection.send("Target.detachFromTarget", { sessionId }).catch(() => {});
  }
}
let sessionEvidence = null;
if (process.argv.includes("--open-sessions")) {
  const iframeTarget = (await discoverTargets(config.cdpOrigin)).find((candidate) => (
    candidate.type === "iframe" && candidate.url?.startsWith(`${config.dashboardOrigin}/`)
  ));
  if (!iframeTarget) {
    sessionEvidence = { status: "dashboard-iframe-unavailable" };
  } else {
    const { sessionId } = await connection.send("Target.attachToTarget", { targetId: iframeTarget.id, flatten: true });
    sessionEvidence = await evaluateInSession(sessionId, `(() => {
      const devices = Array.from(document.querySelectorAll('.session-device-card'));
      const projects = Array.from(document.querySelectorAll('.session-project-card'));
      const sessions = Array.from(document.querySelectorAll('.session-row'));
      return {
        status: devices.length && projects.length && sessions.length ? 'verified' : 'empty',
        deviceCount: devices.length,
        projectCount: projects.length,
        sessionCount: sessions.length,
        firstDevice: devices[0]?.querySelector('.session-device-identity h3')?.textContent?.trim() || null,
        firstDirectory: projects[0]?.dataset.directory || null,
        hasNativeOpenActions: sessions.length > 0 && sessions.every((row) => Boolean(row.querySelector('.session-open')))
      };
    })()`);
    await connection.send("Target.detachFromTarget", { sessionId }).catch(() => {});
  }
}
let priorityEvidence = null;
if (process.argv.includes("--open-priority")) {
  const iframeTarget = (await discoverTargets(config.cdpOrigin)).find((candidate) => (
    candidate.type === "iframe" && candidate.url?.startsWith(`${config.dashboardOrigin}/`)
  ));
  if (!iframeTarget) {
    priorityEvidence = { status: "dashboard-iframe-unavailable" };
  } else {
    const { sessionId } = await connection.send("Target.attachToTarget", { targetId: iframeTarget.id, flatten: true });
    priorityEvidence = await evaluateInSession(sessionId, `(() => {
      const list = document.querySelector('[data-testid="priority-list"]');
      const cards = Array.from(list?.querySelectorAll('.priority-card') || []);
      const scores = cards.map((card) => Number(card.querySelector('.priority-score strong')?.textContent || 0));
      if (list) list.scrollTop = list.scrollHeight;
      const didScroll = Boolean(list && list.scrollTop > 0);
      if (list) list.scrollTop = 0;
      return {
        status: cards.length ? 'verified' : 'empty',
        projectCount: cards.length,
        firstProjects: cards.slice(0, 3).map((card) => ({ project: card.dataset.project, score: Number(card.querySelector('.priority-score strong')?.textContent || 0) })),
        scoresDescending: scores.every((score, index) => index === 0 || scores[index - 1] >= score),
        listScrollable: Boolean(list && list.scrollHeight > list.clientHeight),
        didScroll
      };
    })()`);
    await connection.send("Target.detachFromTarget", { sessionId }).catch(() => {});
  }
}
let dispatchEvidence = null;
if (process.argv.includes("--exercise-dispatch-board")) {
  const iframeTarget = (await discoverTargets(config.cdpOrigin)).find((candidate) => candidate.type === "iframe" && candidate.url?.startsWith(`${config.dashboardOrigin}/`));
  if (!iframeTarget) {
    dispatchEvidence = { status: "dashboard-iframe-unavailable" };
  } else {
    const { sessionId } = await connection.send("Target.attachToTarget", { targetId: iframeTarget.id, flatten: true });
    dispatchEvidence = await evaluateInSession(sessionId, `(async () => {
      const form = document.querySelector('[data-testid="dispatch-form"]');
      const project = document.querySelector('[data-testid="dispatch-project"]');
      const thread = document.querySelector('[data-testid="dispatch-thread"]');
      if (!form || !project || project.options.length < 2) return { status: 'form-unavailable' };
      project.value = project.options[1].value;
      project.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      form.elements.title.value = '界面验证：待排期任务';
      form.elements.prompt.value = '仅用于验证任务看板的项目与对话指派，不会进入发送队列。';
      form.elements.mode.value = 'backlog';
      form.requestSubmit();
      let item = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const data = await fetch('/api/dispatches', { cache: 'no-store' }).then((response) => response.json());
        item = data.items?.find((candidate) => candidate.title === '界面验证：待排期任务') || null;
        if (item) break;
      }
      return {
        status: item ? 'verified' : 'create-failed',
        item,
        selectedProject: project.value,
        selectedThreadMode: thread.value ? 'explicit' : 'latest-in-project',
        visibleInBacklog: Boolean(item && Array.from(document.querySelectorAll('[data-dispatch-list="backlog"] .dispatch-card')).some((card) => card.dataset.dispatchId === item.id))
      };
    })()`);
    await connection.send("Target.detachFromTarget", { sessionId }).catch(() => {});
  }
}
let taskOpenEvidence = null;
if (process.argv.includes("--open-task")) {
  const tasksForOpen = await (await fetch(`${config.dashboardOrigin}/api/tasks`)).json();
  const sidebarLabels = await connection.evaluate(`(() => Array.from(document.querySelectorAll('[role="button"], button, a, [role="link"], [tabindex], div, span'))
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    })
    .map((element) => (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim())
    .filter(Boolean))`);
  const sidebarLabelList = Array.isArray(sidebarLabels) ? sidebarLabels : Object.values(sidebarLabels || {});
  const task = (tasksForOpen.tasks || []).find((candidate) => {
    const title = String(candidate.title || '').replace(/\s+/g, ' ').trim();
    return title && sidebarLabelList.some((label) => label === title || label.startsWith(title.slice(0, 48)));
  });
  if (!task) {
    taskOpenEvidence = {
      status: "no-supported-sidebar-task",
      taskCount: tasksForOpen.tasks?.length || 0,
      visibleSidebarLabels: sidebarLabelList
    };
  } else {
    let iframeTarget = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      iframeTarget = (await discoverTargets(config.cdpOrigin)).find((candidate) => (
        candidate.type === "iframe" && candidate.url?.startsWith(`${config.dashboardOrigin}/`)
      ));
      if (iframeTarget) break;
      await wait(250);
    }
    if (!iframeTarget) throw new Error("Dashboard iframe CDP target was not available");
    const { sessionId } = await connection.send("Target.attachToTarget", { targetId: iframeTarget.id, flatten: true });
    const taskLiteral = JSON.stringify({ id: task.id, title: task.title });
    await evaluateInSession(sessionId, `(() => {
      window.__codexControlConsoleLastOpenResult = null;
      if (!window.__codexControlConsoleOpenResultListener) {
        window.__codexControlConsoleOpenResultListener = true;
        window.addEventListener('message', (event) => {
          if (event.data?.type === 'codex-control-console-open-task-result') {
            window.__codexControlConsoleLastOpenResult = event.data.result || null;
          }
        });
      }
      return true;
    })()`);
    const clickResult = await evaluateInSession(sessionId, `(() => {
      const task = ${taskLiteral};
      const card = Array.from(document.querySelectorAll('article[data-task-id]')).find((element) => element.dataset.taskId === task.id);
      const button = card?.querySelector('button');
      if (!button) return { ok: false, reason: 'task-card-not-found' };
      button.click();
      return { ok: true, title: task.title };
    })()`);
    await wait(1000);
    const hostAfter = await connection.evaluate(`(() => {
      const workspace = document.querySelector('[data-codex-control-console-workspace]');
      return {
        workspaceVisible: Boolean(workspace && workspace.getBoundingClientRect().width > 0),
        bodyText: (document.body.innerText || '').slice(0, 1600),
        nativeTaskVisible: Boolean(document.body.innerText?.includes(${JSON.stringify(task.title)}))
      };
    })()`);
    let response = null;
    if (hostAfter.workspaceVisible) {
      response = await evaluateInSession(sessionId, "window.__codexControlConsoleLastOpenResult");
    }
    taskOpenEvidence = {
      status: hostAfter.workspaceVisible ? (response?.ok === false ? "unsupported" : "workspace-still-open") : "opened-native-task",
      selectedTask: { id: task.id, title: task.title },
      sidebarMatch: sidebarLabelList.find((label) => label === task.title || label.startsWith(task.title.slice(0, 48))),
      clickResult,
      response,
      ...hostAfter
    };
    await connection.send("Target.detachFromTarget", { sessionId }).catch(() => {});
  }
}
let sidebarStructure = null;
if (process.argv.includes("--sidebar-structure")) {
  sidebarStructure = await connection.evaluate(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const targetTexts = ['项目', 'mulitca', 'tokens', 'PAVoice'];
    return targetTexts.map((targetText) => {
      const element = Array.from(document.querySelectorAll('*')).find((candidate) => normalize(candidate.textContent) === targetText);
      if (!element) return { targetText, found: false };
      const ancestors = [];
      let current = element;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        ancestors.push({
          tag: current.tagName,
          role: current.getAttribute('role'),
          className: String(current.className || '').slice(0, 240),
          childCount: current.children.length,
          directTexts: Array.from(current.children).slice(0, 8).map((child) => normalize(child.textContent).slice(0, 120))
        });
      }
      return { targetText, found: true, ancestors };
    });
  })()`);
}
const evidence = await connection.evaluate(`(() => {
  const entry = document.querySelector('[data-codex-control-console-entry]');
  const kanbanEntry = document.querySelector('[data-codex-control-console-kanban-entry]');
  const sessionEntry = document.querySelector('[data-codex-control-console-session-entry]');
  const priorityEntry = document.querySelector('[data-codex-control-console-priority-entry]');
  const iframe = document.querySelector('[data-codex-control-console-frame]');
  const workspace = document.querySelector('[data-codex-control-console-workspace]');
  return {
    title: document.title,
    entryVisible: Boolean(entry && entry.getBoundingClientRect().width > 0),
    entryText: entry ? (entry.innerText || entry.textContent || '').trim() : null,
    entryCount: document.querySelectorAll('[data-codex-control-console-entry]').length,
    kanbanEntryVisible: Boolean(kanbanEntry && kanbanEntry.getBoundingClientRect().width > 0),
    kanbanEntryText: kanbanEntry ? (kanbanEntry.innerText || kanbanEntry.textContent || '').trim() : null,
    kanbanEntryCount: document.querySelectorAll('[data-codex-control-console-kanban-entry]').length,
    sessionEntryVisible: Boolean(sessionEntry && sessionEntry.getBoundingClientRect().width > 0),
    sessionEntryText: sessionEntry ? (sessionEntry.innerText || sessionEntry.textContent || '').trim() : null,
    sessionEntryCount: document.querySelectorAll('[data-codex-control-console-session-entry]').length,
    priorityEntryVisible: Boolean(priorityEntry && priorityEntry.getBoundingClientRect().width > 0),
    priorityEntryText: priorityEntry ? (priorityEntry.innerText || priorityEntry.textContent || '').trim() : null,
    priorityEntryCount: document.querySelectorAll('[data-codex-control-console-priority-entry]').length,
    workspaceVisible: Boolean(workspace && workspace.getBoundingClientRect().width > 0),
    dashboardFrameUrl: iframe?.getAttribute('src') || null,
    bodyText: (document.body.innerText || '').slice(0, 1200),
    dashboardFrameReadyState: iframe?.contentDocument?.readyState || null
  };
})()`);
const health = await (await fetch(`${config.dashboardOrigin}/api/health`)).json();
const tasks = await (await fetch(`${config.dashboardOrigin}/api/tasks`)).json();
if (process.argv.includes("--focus-projects")) {
  await connection.evaluate(`(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const heading = Array.from(document.querySelectorAll('div')).find((element) => normalize(element.textContent) === '项目' && element.classList.contains('group/nav-section-title'));
    heading?.scrollIntoView({ block: 'start', behavior: 'instant' });
    return Boolean(heading);
  })()`);
  await wait(300);
}
if (process.argv.includes("--focus-dispatch-board")) {
  const iframeTarget = (await discoverTargets(config.cdpOrigin)).find((candidate) => candidate.type === "iframe" && candidate.url?.startsWith(`${config.dashboardOrigin}/`));
  if (iframeTarget) {
    const { sessionId } = await connection.send("Target.attachToTarget", { targetId: iframeTarget.id, flatten: true });
    await evaluateInSession(sessionId, `(() => { document.querySelector('[data-testid="dispatch-board"]')?.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`);
    await connection.send("Target.detachFromTarget", { sessionId }).catch(() => {});
    await wait(300);
  }
}
const screenshotArgument = process.argv.find((argument) => argument.startsWith("--screenshot="));
if (process.argv.includes("--screenshot") || screenshotArgument) {
  await wait(500);
  const screenshot = await connection.send("Page.captureScreenshot", { format: "png" });
  const targetPath = screenshotArgument?.slice("--screenshot=".length) || "/tmp/codex-control-console-evidence.png";
  await fs.writeFile(targetPath, Buffer.from(screenshot.data, "base64"));
  evidence.screenshot = targetPath;
}
console.log(JSON.stringify({ endpoint: config.cdpOrigin, target: { id: target.id, url: target.url }, health, taskStatus: tasks.status, taskCount: tasks.tasks?.length ?? 0, filterEvidence, sessionEvidence, priorityEvidence, dispatchEvidence, taskOpenEvidence, sidebarStructure, evidence }, null, 2));
await connection.close();
