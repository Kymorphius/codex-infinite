import { buildNativeRemoteSidebarRenderSource } from "./native-remote-sidebar-render.mjs";
import { buildNativeUnifiedSidebarSource } from "./native-unified-sidebar.mjs";
import { calculateProjectPriority } from "../public/core/project-priority.js";
import { buildNativeRemoteProjectCopyUiSource } from "./native-remote-project-copy-ui.mjs";
import { buildNativeRemoteProjectListUiSource } from "./native-remote-project-list-ui.mjs";
import { normalizeNativeRemoteSidebarItems } from "./native-remote-sidebar-contract.mjs";
import { preserveOfflineProjects } from "./native-sidebar-cache.mjs";
export { normalizeNativeRemoteSidebarItems, buildNativeRemoteSidebarSnapshotScript } from "./native-remote-sidebar-contract.mjs";
const MAX_DEVICES = 8, MAX_PROJECTS_PER_DEVICE = 64, MAX_CONVERSATIONS_PER_PROJECT = 6;
function boundedText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}
function normalizedStatus(value) {
  return ["connected", "empty"].includes(String(value || "").toLowerCase()) ? "connected" : "offline";
}
function compareUpdated(left, right) {
  return String(right?.updatedAt || "").localeCompare(String(left?.updatedAt || ""));
}
function remoteDevice(value) {
  const id = boundedText(value?.id, 120);
  const name = boundedText(value?.name, 80);
  if (!id || !name || value?.kind === "local-codex") return null;
  return { id, name, kind: "remote-codex", status: normalizedStatus(value?.status) };
}
function conversationFromTask(task) {
  const id = boundedText(task?.id, 160);
  const title = boundedText(task?.title, 160) || "未命名会话";
  if (!id) return null;
  return Object.freeze({
    id,
    title,
    status: boundedText(task?.status, 32) || "unknown",
    updatedAt: boundedText(task?.updatedAt, 64) || null
  });
}
export function projectNativeRemoteSidebar(result = {}, now = new Date()) {
  const devices = new Map();
  for (const item of Array.isArray(result.devices) ? result.devices : []) {
    const device = remoteDevice(item);
    if (device && !devices.has(device.id)) devices.set(device.id, { ...device, tasks: [] });
  }
  for (const task of Array.isArray(result.tasks) ? result.tasks : []) {
    if (task?.device?.kind === "local-codex") continue;
    const device = remoteDevice(task?.device);
    if (!device) continue;
    if (!devices.has(device.id)) devices.set(device.id, { ...device, tasks: [] });
    devices.get(device.id).tasks.push(task);
  }

  return Object.freeze([...devices.values()].slice(0, MAX_DEVICES).map((device) => {
    const seenThreads = new Set();
    const projectGroups = new Map();
    for (const task of [...device.tasks].sort(compareUpdated)) {
      const conversation = conversationFromTask(task);
      if (!conversation || seenThreads.has(conversation.id)) continue;
      seenThreads.add(conversation.id);
      const projectId = boundedText(task?.projectId, 160); const key = projectId ? `project:${projectId}` : boundedText(task?.cwd || task?.project, 200) || "未归类";
      const name = boundedText(task?.projectDisplayName || task?.project, 100) || "未归类";
      if (!projectGroups.has(key)) projectGroups.set(key, { key, name, names: new Map(), sourceDirectories: new Set(), conversations: [], tasks: [] });
      const group = projectGroups.get(key); group.names.set(name, (group.names.get(name) || 0) + 1);
      if (boundedText(task?.cwd, 1024)) group.sourceDirectories.add(boundedText(task.cwd, 1024));
      projectGroups.get(key).conversations.push(conversation);
      projectGroups.get(key).tasks.push(task);
    }
    const allProjects = [...projectGroups.values()]
      .map((project) => ({ ...project, name: [...project.names].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))[0]?.[0] || project.name, conversations: project.conversations.sort(compareUpdated), ...calculateProjectPriority(project.tasks, now) }))
      .sort((left, right) => right.priorityScore - left.priorityScore || compareUpdated(left.conversations[0], right.conversations[0]) || left.name.localeCompare(right.name, "zh-CN") || left.key.localeCompare(right.key));
    const projects = allProjects.slice(0, MAX_PROJECTS_PER_DEVICE).map((project) => Object.freeze({
      key: project.key,
      name: project.name,
      sourceDirectories: Object.freeze([...project.sourceDirectories]),
      sourceDirectory: project.sourceDirectories.size === 1 ? [...project.sourceDirectories][0] : null,
      conversationCount: project.conversations.length,
      hiddenConversationCount: Math.max(0, project.conversations.length - MAX_CONVERSATIONS_PER_PROJECT),
      conversations: Object.freeze(project.conversations.slice(0, MAX_CONVERSATIONS_PER_PROJECT))
    }));
    return Object.freeze({
      id: device.id,
      name: device.name,
      kind: device.kind,
      status: device.status,
      projectCount: allProjects.length,
      conversationCount: seenThreads.size,
      hiddenProjectCount: Math.max(0, allProjects.length - MAX_PROJECTS_PER_DEVICE),
      projects: Object.freeze(projects)
    });
  }));
}
export class NativeRemoteSidebarService {
  constructor({ adapter, cacheMs = 5_000, clock = () => Date.now() } = {}) {
    this.adapter = adapter;
    this.cacheMs = cacheMs;
    this.clock = clock;
    this.snapshot = Object.freeze([]);
    this.refreshedAt = 0;
    this.refreshing = null;
  }
  async read() {
    const stale = !this.refreshedAt || this.clock() - this.refreshedAt >= this.cacheMs;
    if (stale && !this.refreshing) void this.refresh();
    return this.snapshot;
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = Promise.resolve(this.adapter?.listTasks?.())
      .then((result) => {
        this.snapshot = preserveOfflineProjects(projectNativeRemoteSidebar(result), this.snapshot);
        this.refreshedAt = this.clock();
        return this.snapshot;
      })
      .catch(() => {
        this.refreshedAt = this.clock();
        return this.snapshot;
      })
      .finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
}

export function buildNativeRemoteSidebarInjectionScript() {
  return `(() => {
  const VERSION = '2026-09-08.unified.2', REMOTE_SELECTED_ATTRIBUTE = 'data-codex-control-console-remote-thread-selected';
  const ROOT_SELECTOR = '[data-codex-control-console-remote-sidebar]';
  if (window.__codexControlConsoleRemoteSidebarVersion === VERSION && window.__codexControlConsoleRemoteSidebarObserver) return;
  window.__codexControlConsoleRemoteSidebarObserver?.disconnect?.(); if (window.__codexControlConsoleRemoteNativeSelectionListener) document.removeEventListener('click', window.__codexControlConsoleRemoteNativeSelectionListener, true);
  document.querySelectorAll(ROOT_SELECTOR).forEach((node) => node.remove());
  window.__codexControlConsoleRemoteSidebarVersion = VERSION;
  const expandedDevices = window.__codexControlConsoleExpandedRemoteDevices || new Set(), expandedProjects = window.__codexControlConsoleExpandedRemoteProjects || new Set(), expandedProjectLists = window.__codexControlConsoleExpandedRemoteProjectLists || new Set();
  let selectedConversationKey = window.__codexControlConsoleSelectedRemoteConversation || '', devices = [], root = null, placementPending = false, templateSignature = '';
  window.__codexControlConsoleExpandedRemoteDevices = expandedDevices; window.__codexControlConsoleExpandedRemoteProjects = expandedProjects; window.__codexControlConsoleExpandedRemoteProjectLists = expandedProjectLists;
  ${buildNativeRemoteProjectCopyUiSource()}
  ${buildNativeRemoteProjectListUiSource()}
  ${buildNativeUnifiedSidebarSource()}

  function element(tag, text, css) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (css) node.style.cssText = css;
    return node;
  }
  const selectionStyle = document.getElementById('codex-control-console-remote-selection-style') || document.head.appendChild(element('style')); selectionStyle.id = 'codex-control-console-remote-selection-style';
  selectionStyle.textContent = 'html[' + REMOTE_SELECTED_ATTRIBUTE + '] [data-app-action-sidebar-thread-id][aria-current="page"]{background-color:transparent!important}'; document.documentElement.toggleAttribute(REMOTE_SELECTED_ATTRIBUTE, Boolean(selectedConversationKey));

  function deviceIcon() {
    const namespace = 'http://www.w3.org/2000/svg', icon = document.createElementNS(namespace, 'svg');
    icon.setAttribute('viewBox', '0 0 20 20'); icon.setAttribute('aria-hidden', 'true');
    icon.style.cssText = 'display:block;width:16px;height:16px;flex:none;opacity:.7;';
    const screen = document.createElementNS(namespace, 'rect');
    for (const [name, value] of Object.entries({ x: '2.5', y: '3.5', width: '15', height: '10.5', rx: '1.6', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4' })) screen.setAttribute(name, value);
    const stand = document.createElementNS(namespace, 'path');
    for (const [name, value] of Object.entries({ d: 'M7 17h6M10 14v3', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round' })) stand.setAttribute(name, value);
    icon.append(screen, stand); return icon;
  }
  function nativeProjectsSection() {
    return Array.from(document.querySelectorAll('section')).find((section) => {
      const toggle = section.querySelector('[data-app-action-sidebar-section-toggle]');
      return toggle && /^(项目|Projects)$/.test((toggle.textContent || '').trim());
    }) || null;
  }

  function typographyOf(node, fallback) {
    const style = node ? getComputedStyle(node) : null;
    return {
      fontFamily: style?.fontFamily || fallback.fontFamily,
      fontSize: style?.fontSize || fallback.fontSize,
      fontWeight: style?.fontWeight || fallback.fontWeight,
      lineHeight: style?.lineHeight || fallback.lineHeight
    };
  }

  function nativeTypography() {
    const projects = nativeProjectsSection();
    const heading = projects?.querySelector('[data-app-action-sidebar-section-toggle] .min-w-0.truncate');
    const projectRow = projects?.querySelector('[data-app-action-sidebar-project-row]') || document.querySelector('[data-app-action-sidebar-project-row]');
    const project = projectRow ? document.getElementById(projectRow.getAttribute('aria-labelledby') || '') : null;
    const conversation = document.querySelector('[data-app-action-sidebar-thread-id] .text-base');
    const family = '-apple-system, system-ui, "Segoe UI", sans-serif';
    return {
      heading: typographyOf(heading, { fontFamily: family, fontSize: '14px', fontWeight: '500', lineHeight: '21px' }),
      project: typographyOf(project, { fontFamily: family, fontSize: '14px', fontWeight: '400', lineHeight: '21px' }),
      conversation: typographyOf(conversation, { fontFamily: family, fontSize: '14px', fontWeight: '400', lineHeight: '20px' })
    };
  }

  function nativeTemplates() {
    const projects = nativeProjectsSection();
    const heading = projects?.querySelector('[data-app-action-sidebar-section-toggle]');
    const project = projects?.querySelector('[data-app-action-sidebar-project-row]') || document.querySelector('[data-app-action-sidebar-project-row]');
    const thread = document.querySelector('[data-app-action-sidebar-thread-id]:not([data-app-action-sidebar-thread-selected="true"])') || document.querySelector('[data-app-action-sidebar-thread-id]');
    return {
      headingClass: heading?.className || '',
      headingContainerClass: heading?.parentElement?.parentElement?.parentElement?.className || '',
      headingTextClass: heading?.parentElement?.parentElement?.className || '',
      projectClass: project?.className || '',
      projectContent: project?.firstElementChild || null,
      threadClass: String(thread?.className || '').split(/\\s+/).filter((token) => token !== 'bg-primary-ghost-hover').join(' '),
      threadContent: Array.from(thread?.children || []).find((child) => child.classList?.contains('flex') && child.classList?.contains('h-full')) || null,
      projectIcon: project?.firstElementChild?.querySelector('svg') || null,
    };
  }

  function templatesSignature(templates) { return [templates.headingClass, templates.projectClass, templates.threadClass, Boolean(templates.projectContent), Boolean(templates.threadContent)].join('\\n'); }
  function applyTypography(node, typography, color) {
    node.style.fontFamily = typography.fontFamily;
    node.style.fontSize = typography.fontSize;
    node.style.fontWeight = typography.fontWeight;
    node.style.lineHeight = typography.lineHeight;
    node.style.color = color;
    node.style.opacity = '1';
    return node;
  }
  function ensurePlacement() {
    if (unifiedSidebar.enabled) { root?.remove(); unifiedSidebar.place(); return; }
    document.querySelectorAll(ROOT_SELECTOR).forEach((node) => { if (node !== root) node.remove(); }); if (!devices.length) { root?.remove(); return; }
    const templates = nativeTemplates();
    if (root && templatesSignature(templates) !== templateSignature) render();
    const nativeProjects = nativeProjectsSection();
    const nativeProjectsWrapper = nativeProjects?.parentElement;
    const sectionsContainer = nativeProjectsWrapper?.parentElement;
    if (!sectionsContainer) return;
    if (!root) render();
    if (root) {
      root.style.order = '65';
      if (root.parentElement !== sectionsContainer) sectionsContainer.insertBefore(root, nativeProjectsWrapper);
    }
  }
  function leafWithText(root) {
    return Array.from(root?.querySelectorAll('span') || []).find((span) => span.children.length === 0 && (span.textContent || '').trim());
  }
  function nativeSectionHeader(label, templates) {
    const container = element('div', null);
    container.className = templates.headingContainerClass || 'group/nav-section-title flex items-center justify-between gap-2 browser:h-9 browser:ps-2.5 pe-0.5 ps-2';
    const textContainer = element('div', null);
    textContainer.className = templates.headingTextClass || 'min-w-0 flex-1 text-base font-medium text-tertiary opacity-75 browser:leading-4.5';
    const inner = element('div', null); inner.className = 'flex min-w-0 flex-1';
    const labelNode = element('span', label); labelNode.className = 'min-w-0 truncate';
    const button = element('button', null); button.type = 'button'; button.className = templates.headingClass || 'group/section-toggle flex min-w-0 flex-1 items-center gap-1 rounded-md py-0.5 pe-1 text-start browser:h-9 cursor-default';
    button.append(labelNode); inner.append(button); textContainer.append(inner); container.append(textContainer);
    return container;
  }

  function nativeTreeRow(label, count, icon, templates, depth = 0) {
    const row = element('div', null); row.className = templates.projectClass; row.setAttribute('role', 'button'); row.tabIndex = 0;
    const content = templates.projectContent?.cloneNode(true) || element('div', null, 'display:flex;min-width:0;flex:1;align-items:center;');
    content.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    const sourceIcon = content.querySelector('svg'); if (sourceIcon && icon) sourceIcon.replaceWith(icon.cloneNode(true));
    const name = leafWithText(content); if (name) name.textContent = label; else content.append(element('span', label));
    if (depth) content.style.paddingInlineStart = String(depth * 24) + 'px';
    const trailing = element('span', count == null ? '' : String(count)); trailing.className = 'me-2 shrink-0 text-base text-tertiary';
    row.append(content, trailing); row.setAttribute('aria-label', label); return row;
  }

  function nativeThreadRow(conversation, templates, depth) {
    const row = element('div', null); row.className = templates.threadClass; row.setAttribute('role', 'button'); row.tabIndex = 0;
    const content = templates.threadContent?.cloneNode(true) || element('div', null, 'display:flex;height:100%;width:100%;align-items:center;');
    content.querySelectorAll('button,[id],[data-codex-control-console-sidebar-labels]').forEach((node) => node.remove());
    const title = content.querySelector('[data-thread-title-trigger]') || content;
    const name = element('span', conversation.title); name.className = 'min-w-0 truncate'; title.replaceChildren(name);
    content.style.paddingInlineStart = String(depth * 24) + 'px';
    row.append(content); return row;
  }

  function openRemoteConversation(reference) {
    if (typeof window.__codexControlConsoleOpenRemoteConversation === 'function') return window.__codexControlConsoleOpenRemoteConversation(reference);
    document.querySelector('[data-codex-control-console-session-entry]')?.click();
    let attempts = 0;
    const deliver = () => {
      const target = document.querySelector('[data-codex-control-console-frame]');
      if (target?.contentWindow) {
        const origin = new URL(target.src, location.href).origin;
        target.contentWindow.postMessage({ type: 'codex-control-console-open-remote-conversation', reference }, origin);
        return;
      }
      if (++attempts < 30) requestAnimationFrame(deliver);
    };
    deliver();
  }

  ${buildNativeRemoteSidebarRenderSource()}

  function schedulePlacement() {
    if (placementPending) return;
    placementPending = true;
    requestAnimationFrame(() => { placementPending = false; ensurePlacement(); });
  }

  window.__codexControlConsoleSetRemoteSidebar = (items) => { devices = Array.isArray(items) ? items : []; render(); ensurePlacement(); return { count: devices.length }; };
  window.__codexControlConsoleRemoteNativeSelectionListener = (event) => {
    if (!event.target?.closest?.('[data-app-action-sidebar-thread-id]') || !selectedConversationKey) return;
    selectedConversationKey = ''; window.__codexControlConsoleSelectedRemoteConversation = ''; document.documentElement.removeAttribute(REMOTE_SELECTED_ATTRIBUTE); render(); ensurePlacement();
  };
  document.addEventListener('click', window.__codexControlConsoleRemoteNativeSelectionListener, true);
  window.__codexControlConsoleRemoteSidebarObserver = new MutationObserver(schedulePlacement);
  window.__codexControlConsoleRemoteSidebarObserver.observe(document.documentElement, { childList: true, subtree: true });
  schedulePlacement();
})()`;
}
