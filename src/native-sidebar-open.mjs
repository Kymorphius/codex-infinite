// Native navigation is independent from sidebar mutation services.
export async function openNativeSidebarItem(input, model, snapshot) {
  const section = model.sections.find(section => section.id === input.sectionId);
  const record = snapshot.projects.find(item => item.key === input.itemKey) || snapshot.conversations.find(item => item.key === input.itemKey);
  if (!record) throw Error('原生条目已不存在');
  if (record.source === 'codex' && input.itemKey.startsWith('codex:thread:local:')) {
    window.postMessage({ type: 'navigate-to-route', path: '/local/' + record.id }, '*'); return { opened: true };
  }
  const project = model.projectByKey.get(input.itemKey);
  if (project) {
    if (section?.native?.collapsed) section.native.onCollapsedChange(false);
    for (let attempt = 0; attempt < 12; attempt++) {
      const row = Array.from(document.querySelectorAll('[data-app-action-sidebar-project-id]')).find(row => row.getAttribute('data-app-action-sidebar-project-id') === record.id);
      if (row) { row.scrollIntoView({ block: 'center' }); row.click(); return { opened: true }; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  if (record.route && /^\/(?:[A-Za-z0-9_/-]|%[0-9A-Fa-f]{2}){1,480}$/.test(record.route)) {
    window.postMessage({ type: 'navigate-to-route', path: record.route }, '*'); return { opened: true };
  }
  throw Error('此条目的原生打开入口尚未就绪');
}
