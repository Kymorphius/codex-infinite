export const GENERAL_CHECKLIST_KEY = 'ccc:general-inbox:v1';

export function projectChecklistBoardItems(items = []) {
  return items.filter(item => item && typeof item.id === 'string' && typeof item.text === 'string')
    .slice(0, 1000)
    .map(item => ({
      id: item.id,
      text: item.text,
      createdAt: item.createdAt || null,
      done: item.done === true,
      assignedThreadId: item.assignedThreadId || null
    }));
}
