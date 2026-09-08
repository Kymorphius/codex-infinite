# Project search actions

Add an always-visible, keyboard-accessible new-conversation button at the right
of each project search result. Keep expansion and creation as separate controls;
creation must not expand the result or submit a prompt. Use the exact local project
ID with the native new-conversation flow, including empty projects and projects
whose original sidebar rows are not mounted. Preserve search query and expansion.

Add Finder / File Explorer to the existing result context menu, retaining copy
actions. Use current catalog roots, with a per-root submenu for multi-root projects.
Delegate opening to the native desktop file-manager service. Never interpolate
paths into shell commands. The DOM adapter owns native integration and discovers
the native service by capability, without fixed minified export names.

Add “在项目中打开” only to actual project-search result menus. It resolves the
catalog identity to the native sidebar project, restores the native workspace,
centers and expands that project, then opens the first indexed conversation.
Ordinary search-result conversation clicks must not navigate the Projects section.

These actions operate on projects belonging to the current desktop. Federated
peer projects must show an explicit unavailable explanation; their paths and IDs
must never be passed to this desktop's local actions. Existing remote conversation
navigation is unchanged. Unknown native capabilities fail visibly.

Verify independent create/expand clicks, exact project IDs, missing/multiple roots,
remote rejection and menu dispatch. Run required checks and tests. Deploy to Mac
and Windows services, inspect real result controls and verify native composer
project selection plus file-manager opening without submitting a conversation.

## Verification

Mac: searched 看板, whose original project row was not mounted; clicked the result
create button and confirmed 看板 in the native new-draft composer. Opened devspace
and confirmed Finder's front-window target was its exact directory.
Windows: searched windows补丁服务器, clicked create and confirmed that project in
the native composer. File Explorer's Shell.Application window list confirmed its
directory was opened. Restored both original conversations and search queries;
no prompt was submitted. Both services load the updated modules.
