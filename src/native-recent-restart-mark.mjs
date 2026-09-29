// Manual "needs a full app restart" toggle on a recent row. Only native Codex and Claude
// CLI conversations qualify; the mark itself lives in the shared page store.
export function nativeRecentRestartEligible(tab) {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tab?.id || '') && (tab.kind === 'local' || (tab.kind === 'terminal' && tab.engine !== 'shell'));
}

export function createNativeRecentRestartButton(documentRef, tab) {
  if (!nativeRecentRestartEligible(tab)) return null;
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = 'ccc-native-recent-restart';
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void window.__codexControlConsoleRestartMarks?.toggle({ id: tab.id, provider: tab.kind, deviceId: tab.deviceId, title: tab.title });
  });
  return button;
}

export function updateNativeRecentRestartMark(row, tab, store = window.__codexControlConsoleRestartMarks) {
  const button = row.restartButton;
  if (!button) return;
  const mark = store?.get?.(tab.id) || null;
  const signature = mark ? mark.status + mark.markedAt : '';
  if (button.markSignature === signature) return;
  button.markSignature = signature;
  const time = (value) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const verify = mark?.status === 'verify';
  const label = !mark ? '标记为需要重启' : verify ? '待验收 · 已于 ' + time(mark.restartedAt || mark.markedAt) + ' 重启（点击标为已验收）' : '需要重启 · 标记于 ' + time(mark.markedAt) + '（点击取消）';
  button.setAttribute('aria-pressed', String(Boolean(mark)));
  button.dataset.status = mark ? mark.status : '';
  button.setAttribute('aria-label', label);
  button.title = label;
}

const RESTART_ICON = 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath d=%27M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.6%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E")';
const CHECK_ICON = 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath d=%27M3 8.5l3.2 3.2L13 4.8%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.8%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E")';
export const NATIVE_RECENT_RESTART_STYLE =
  '.ccc-native-recent-restart{flex:0 0 26px;width:26px;height:26px;border:0;border-radius:7px;padding:0;background:transparent;color:inherit;opacity:0;cursor:pointer}' +
  '.ccc-native-recent-restart::before{content:"";display:block;width:14px;height:14px;margin:auto;background:currentColor;-webkit-mask:' + RESTART_ICON + ' center/14px no-repeat;mask:' + RESTART_ICON + ' center/14px no-repeat}' +
  '.ccc-native-recent-row:hover .ccc-native-recent-restart,.ccc-native-recent-restart:focus-visible{opacity:.55}' +
  '.ccc-native-recent-restart:hover{opacity:1!important;background:color-mix(in srgb,currentColor 10%,transparent)}' +
  '.ccc-native-recent-restart[aria-pressed="true"]{opacity:1;color:#e89a6c}' +
  '.ccc-native-recent-restart[data-status="verify"]{color:#7da9ff}' +
  '.ccc-native-recent-restart[data-status="verify"]::before{-webkit-mask-image:' + CHECK_ICON + ';mask-image:' + CHECK_ICON + '}';
