// Single source for native sidebar flex order. Groups, top to bottom:
// search · attention · projects · user sections · ChatGPT.
export const NATIVE_SIDEBAR_ORDER = Object.freeze({
  projectSearch: 10, sentMessageSearch: 11,
  pinned: 20, review: 21, active: 22, codex: 23, history: 24,
  projects: 30, newProjects: 31, remote: 32,
  userSection: 45,
  chats: 50, chatProjects: 51, cloud: 52
});

// Native section headings mapped to their slot. Known user sections keep their
// workflow sequence; any other user-created section shares `userSection` and so
// keeps the native (user-arranged) DOM order within the group.
export const NATIVE_SECTION_ORDER = Object.freeze([
  ['Pinned', NATIVE_SIDEBAR_ORDER.pinned], ['置顶', NATIVE_SIDEBAR_ORDER.pinned], ['已置顶', NATIVE_SIDEBAR_ORDER.pinned],
  ['Projects', NATIVE_SIDEBAR_ORDER.projects],
  ['现在', 40], ['等待', 41], ['本周', 42], ['待整理', 43], ['临时', 44],
  ['Recents', NATIVE_SIDEBAR_ORDER.chats], ['项目（聊天）', NATIVE_SIDEBAR_ORDER.chatProjects], ['云工作', NATIVE_SIDEBAR_ORDER.cloud]
]);
