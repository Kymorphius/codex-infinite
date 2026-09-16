import { openNativeSidebarItem } from './native-sidebar-open.mjs';
import { readNativeSidebarModel, projectNativeSidebarModel } from './native-sidebar-model.mjs';

// Detect semantic native actions, not minified export names. Ambiguity disables an action.
export function findNativeSidebarActions(module) {
  const entries = Object.values(module).flatMap(value => {
    if (typeof value !== 'function') return [];
    try { return [{ value, code: Function.prototype.toString.call(value) }]; } catch { return []; }
  });
  const one = predicate => { const matches = entries.filter(({ code }) => predicate(code)); return matches.length === 1 ? matches[0].value : null; };
  return {
    create: one(code => code.includes('crypto.randomUUID()') && code.includes('appServerLegacySectionIds') && code.includes('sectionCreated')),
    rename: one(code => code.includes('sectionUpdated') && code.includes('kind:`details`') && code.length < 1000),
    delete: one(code => code.includes('sectionDeleted') && code.includes('kind:`delete`') && code.length < 1000),
    move: one(code => code.includes('beforeItemKey:') && code.includes('beforeMove:') && code.includes('sidebar-custom-sections:')),
    remove: one(code => code.includes('kind:`remove`,itemKey:') && code.length < 600),
    pinProject: one(code => code.includes('sidebar-project-pin:') && code.includes('PINNED_PROJECT_IDS')),
    pinThread: one(code => code.includes('sidebar-thread-pin:') && code.includes('shouldCommit:')),
    pinChatProject: one(code => code.includes('chatgpt-project-pin:') && code.includes('queryClient:')),
    pinChat: one(code => code.includes('conversation:') && code.includes('isPinned:') && code.includes('.promise') && code.includes('.delete(') && code.length < 1200)
  };
}

export async function loadNativeSidebarActions(find) {
  const urls = [...new Set(performance.getEntriesByType('resource').map(entry => entry.name))].filter(value => {
    try { const url = new URL(value); return url.protocol === 'app:' && url.host === '-' && /^\/assets\/app-initial-[\w-]+\.js$/.test(url.pathname); } catch { return false; }
  });
  if (urls.length !== 1) throw Error('原生侧边栏操作尚未就绪');
  return find(await import(urls[0]));
}

export async function performNativeSidebarAction(input, expectedLayout, readModel, projectModel, load, find, openItem = openNativeSidebarItem) {
  const model = readModel(document), snapshot = projectModel(model);
  const layout = JSON.stringify({ sections: snapshot.sections.map(({ id, name, kind, itemKeys }) => ({ id, name, kind, itemKeys })), projects: snapshot.projects.map(({ key, conversationKeys }) => ({ key, conversationKeys })) });
  if (layout !== expectedLayout) throw Error('所属设备的侧边栏已变化，请刷新后重试');
  // Opening uses existing native rows/routes, not sidebar mutation services.
  if (input.action === 'open') return openItem(input, model, snapshot);
  const actions = await load(find);
  // Import can yield; re-read before invoking any native action.
  const current = readModel(document), fresh = projectModel(current);
  const freshLayout = JSON.stringify({ sections: fresh.sections.map(({ id, name, kind, itemKeys }) => ({ id, name, kind, itemKeys })), projects: fresh.projects.map(({ key, conversationKeys }) => ({ key, conversationKeys })) });
  if (freshLayout !== expectedLayout || current.scope?.node !== model.scope?.node) throw Error('原生侧边栏已变化，请重试');
  const scope = current.scope;
  if (!scope) throw Error('无法确定原生侧边栏操作范围');
  const section = current.sections.find(section => section.id === input.sectionId);
  const call = (fn, ...args) => { if (typeof fn !== 'function') throw Error('当前原生版本不支持此操作'); return fn(...args); };
  switch (input.action) {
    case 'section-create': {
      const id = call(actions.create, scope, input.name);
      if (!id) throw Error('原生分区未创建');
      return { sectionId: 'custom:' + id };
    }
    case 'section-rename': call(actions.rename, scope, section.id.slice(7), input.name); return {};
    case 'section-delete': call(actions.delete, scope, section.id.slice(7)); return {};
    case 'section-shift': call(section.native.sectionReorderDnd?.moveSection, section.id, input.direction); return {};
    case 'item-shift': {
      const keys = [...section.list.keys], from = keys.indexOf(input.itemKey), to = from + input.direction;
      if (from < 0 || to < 0 || to >= keys.length) throw Error('条目已在列表边界');
      keys.splice(from, 1); keys.splice(to, 0, input.itemKey);
      await call(section.list.onOrderChange, keys); return {};
    }
    case 'item-move': {
      const project = current.projectByKey.get(input.itemKey), conversation = current.conversationByKey.get(input.itemKey);
      const record = fresh.projects.find(item => item.key === input.itemKey) || fresh.conversations.find(item => item.key === input.itemKey);
      if (!record) throw Error('原生条目已不存在');
      const pin = async value => {
        if (project?.source === 'chatgpt') return call(actions.pinChatProject, { scope, project: project.project, isPinned: value, queryClient: scope.queryClient });
        if (project) return call(actions.pinProject, scope, record.id, value);
        if (conversation?.source === 'chatgpt') return call(actions.pinChat, { scope, conversation: conversation.target.conversation, isPinned: value });
        return call(actions.pinThread, scope, record.id, value);
      };
      const wasPinned = fresh.sections.find(section => section.id === 'pinned')?.itemKeys.includes(input.itemKey) === true;
      if (input.targetSectionId === 'pinned') { await pin(true); return {}; }
      if (input.targetSectionId.startsWith('custom:')) {
        await call(actions.move, scope, input.targetSectionId.slice(7), input.itemKey, { beforeMove: async () => { if (wasPinned) await pin(false); return true; } });
      } else {
        if (wasPinned) await pin(false);
        call(actions.remove, scope, input.itemKey);
      }
      return {};
    }
    default: throw Error('不支持此侧边栏操作');
  }
}

export function buildNativeSidebarActionScript(input, expectedLayout) {
  return `(${performNativeSidebarAction.toString()})(${JSON.stringify(input)},${JSON.stringify(expectedLayout)},${readNativeSidebarModel.toString()},${projectNativeSidebarModel.toString()},${loadNativeSidebarActions.toString()},${findNativeSidebarActions.toString()},${openNativeSidebarItem.toString()})`;
}
export function buildNativeSidebarCapabilitiesScript() {
  return `(${loadNativeSidebarActions.toString()})(${findNativeSidebarActions.toString()}).then(actions=>({create:!!actions.create,rename:!!actions.rename,delete:!!actions.delete,move:!!actions.move&&!!actions.remove&&!!actions.pinProject&&!!actions.pinThread}))`;
}
