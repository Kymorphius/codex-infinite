const paths = {
  console: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M15 4v16M6 8v4m6-4v7m6-7v3"/>',
  sessions: '<path d="M14 15H8l-4 3V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5a4 4 0 0 1-4 4Z"/><path d="M9 18h7l4 3V10a2 2 0 0 0-2-2"/>',
  priority: '<path d="M7 4v16m-3-3 3 3 3-3M13 5h8m-8 5h6m-6 5h4m-4 5h2"/>'
};

export const NATIVE_ENTRY_ICONS = Object.freeze(Object.fromEntries(
  Object.entries(paths).map(([module, path]) => [module,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1.1rem" height="1.1rem" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="display:block;flex-shrink:0">' + path + '</svg>'
  ])
));
