# Conversation viewing and review aliases

Opening or activating a local task tab records its actual view time. Immediately
hide that task's current completion from 等待查看, including when native unread
state is slow to update or another profile still has its blue dot. This is a
console-owned acknowledgement, never a write to native unread state or project
membership. A later completion/update can enter review again; leaving a tab open
alone must not acknowledge later results.

Add 查看历史 after codex委派 (order 8), with identical native-style heading,
collapse behavior and task opening. Sort unique local tasks by last viewed time,
newest first. Reopening an existing tab moves it to the front; background snapshot
refresh, title changes and tab restoration do not fabricate viewing activity.
History survives window/service restarts in window-local localStorage, retaining
up to 200 most recently viewed tasks. It starts collecting after installation;
existing tab state does not supply historical viewing timestamps. Original
project membership and Codex delegation classification stay unchanged. History
is an additional alias and does not permit drag/drop.

Use a pure bounded history policy and browser-owned storage adapter. Hook the
existing local-tab open/activate paths so native project rows, search results and
automatic section rows agree. Store task identity, title, optional project label,
view time and acknowledged completion revision only; no transcript content.
Tests cover immediate removal, polling/restart stability, later completions,
ordering/deduplication, invalid stored data, and view notifications from the real
tab controller without artificial background viewing. Run check and full tests;
deploy narrowly and read back versions on Mac and Windows dedicated consoles.
