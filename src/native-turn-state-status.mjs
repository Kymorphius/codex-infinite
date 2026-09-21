import { readNativeComposerThreadId } from "./native-composer-thread-id.mjs";

export function normalizeNativeTurnStateSnapshot(value) {
  const entries = (Array.isArray(value?.entries) ? value.entries : []).slice(-256).flatMap((entry) => {
    const threadId = typeof entry?.threadId === "string" ? entry.threadId.toLowerCase() : "";
    const turnId = typeof entry?.turnId === "string" ? entry.turnId.toLowerCase() : null;
    const turnState = entry?.turnState?.present === false
      ? { present: false }
      : entry?.turnState?.present === true && Number.isSafeInteger(entry.turnState.length) && entry.turnState.length > 0 && entry.turnState.length <= 16_384
        ? { present: true, length: entry.turnState.length }
        : null;
    if (!/^[0-9a-f-]{36}$/.test(threadId) || !turnState) return [];
    return [{ threadId, turnId: turnId && /^[0-9a-f-]{36}$/.test(turnId) ? turnId : null, model: typeof entry.model === "string" ? entry.model.slice(0, 120) : null, status: Number.isInteger(entry.status) ? entry.status : null, upstreamAttempts: Number.isSafeInteger(entry.upstreamAttempts) ? entry.upstreamAttempts : null, startedAt: Number.isSafeInteger(entry.startedAt) ? entry.startedAt : null, endedAt: Number.isSafeInteger(entry.endedAt) ? entry.endedAt : null, turnState }];
  });
  return { available: value?.available === true, observedAt: Number.isSafeInteger(value?.observedAt) ? value.observedAt : Date.now(), entries };
}

export function summarizeNativeTurnState(snapshot, threadId, turnId) {
  const entries = summarizeNativeTurnStates(snapshot, threadId).entries.filter((entry) => entry.turnId === turnId);
  const latest = [...entries].reverse().find((entry) => entry.turnState.present) || entries.at(-1) || null;
  return { available: snapshot.available, entries, counts: entries.reduce((counts, entry) => { const key = entry.turnState.present ? String(entry.turnState.length) : "none"; counts[key] = (counts[key] || 0) + 1; return counts; }, {}), latest };
}

export function summarizeNativeTurnStates(snapshot, threadId) {
  const entries = snapshot.entries.filter((entry) => entry.threadId === threadId).sort((left, right) => (left.endedAt || left.startedAt || 0) - (right.endedAt || right.startedAt || 0));
  const counts = {};
  for (const entry of entries) {
    const key = entry.turnState.present ? String(entry.turnState.length) : "none";
    counts[key] = (counts[key] || 0) + 1;
  }
  const latest = [...entries].reverse().find((entry) => entry.turnState.present) || entries.at(-1) || null;
  return { available: snapshot.available, entries, counts, latest };
}

export function summarizeGlobalNativeTurnStates(snapshot) {
  const grouped = new Map();
  for (const entry of snapshot.entries) grouped.set(entry.threadId, [...(grouped.get(entry.threadId) || []), entry]);
  const entries = [...grouped.values()].map((items) => {
    const sorted = items.slice().sort((a, b) => (a.endedAt || a.startedAt || 0) - (b.endedAt || b.startedAt || 0));
    return [...sorted].reverse().find((entry) => entry.turnState.present) || sorted.at(-1);
  }).filter(Boolean);
  const counts = {};
  for (const entry of entries) { const key = entry.turnState.present ? String(entry.turnState.length) : "none"; counts[key] = (counts[key] || 0) + 1; }
  const ordered = entries.slice().sort((a, b) => (a.endedAt || a.startedAt || 0) - (b.endedAt || b.startedAt || 0));
  const latest = [...snapshot.entries].sort((a, b) => (a.endedAt || a.startedAt || 0) - (b.endedAt || b.startedAt || 0)).reverse().find((entry) => entry.turnState.present) || ordered.at(-1) || null;
  return { available: snapshot.available, entries: ordered, counts, latest, conversationCount: ordered.length };
}

export function buildNativeTurnStateSnapshotScript(snapshot) {
  return `window.__codexControlConsoleSetTurnStateSnapshot?.(${JSON.stringify(normalizeNativeTurnStateSnapshot(snapshot))}) || null`;
}

export function buildNativeTurnStateInjectionScript() {
  return `(() => {
  if (window.__codexControlConsoleTurnStateVersion === '2026-09-21.6') return;
  if (window.__codexControlConsoleTurnStateTimer) clearInterval(window.__codexControlConsoleTurnStateTimer);
  document.querySelector('[data-codex-control-console-turn-state]')?.remove();
  document.querySelector('[data-codex-control-console-turn-state-popover]')?.remove();
  document.querySelector('[data-codex-control-console-global-turn-state]')?.remove();
  document.querySelectorAll('[data-codex-control-console-turn-state-turn]').forEach((node)=>node.remove());
  window.__codexControlConsoleTurnStateVersion = '2026-09-21.6';
  const readThreadId = ${readNativeComposerThreadId.toString()};
  const summarize = ${summarizeNativeTurnStates.toString()};
  const summarizeNativeTurnStates = summarize;
  const summarizeTurn = ${summarizeNativeTurnState.toString()};
  const summarizeGlobal = ${summarizeGlobalNativeTurnStates.toString()};
  let snapshot = { available:false, observedAt:Date.now(), entries:[] };

  function closePopover() { document.querySelector('[data-codex-control-console-turn-state-popover]')?.remove(); }
  function toneFor(entry) { if (!entry?.turnState?.present) return '#a7a7ad'; if (entry.turnState.length === 292) return '#62bd84'; if (entry.turnState.length === 312) return '#d39a19'; return '#8ab4f8'; }
  function labelFor(entry) { return entry?.turnState?.present ? String(entry.turnState.length) : '—'; }
  function formatTime(value) { if (!value) return '进行中'; try { return new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}); } catch { return '未知时间'; } }

  function openPopover(button, summary, titleText='当前会话 · Turn State') {
    const existing = document.querySelector('[data-codex-control-console-turn-state-popover]'); if (existing) { existing.remove(); return; }
    const panel = document.createElement('div'); panel.setAttribute('data-codex-control-console-turn-state-popover',''); panel.setAttribute('role','dialog'); panel.setAttribute('aria-label','Turn State 观测');
    panel.style.cssText='position:fixed;z-index:2147483646;width:340px;max-height:min(520px,calc(100vh - 28px));overflow:auto;padding:14px;border:1px solid rgba(128,128,128,.3);border-radius:14px;background:rgb(35,35,37);color:#f2f2f2;box-shadow:0 16px 46px rgba(0,0,0,.4);font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-app-region:no-drag;app-region:no-drag;';
    const title=document.createElement('strong');title.textContent=titleText;title.style.cssText='display:block;font-size:14px;margin-bottom:5px';
    const note=document.createElement('p');note.textContent='仅观察响应头长度，不保存 state；长度本身不代表模型质量。';note.style.cssText='margin:0 0 12px;color:#a7a7ad;line-height:1.45';panel.append(title,note);
    const counts=document.createElement('div');counts.style.cssText='display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px';
    const labels=Object.entries(summary.counts).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}));
    for(const [key,count] of labels){const chip=document.createElement('span');chip.textContent=(key==='none'?'无 State':key)+' × '+count;chip.style.cssText='padding:4px 7px;border-radius:999px;background:rgba(255,255,255,.07);color:#d7d7dc';counts.append(chip);} if(!labels.length){const empty=document.createElement('span');empty.textContent='当前会话还没有观测记录';empty.style.color='#a7a7ad';counts.append(empty);} panel.append(counts);
    const list=document.createElement('div');list.style.cssText='display:grid;gap:7px';
    for(const entry of summary.entries.slice(-12).reverse()){const row=document.createElement('div');row.style.cssText='display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;padding:8px;border-radius:9px;background:rgba(255,255,255,.045)';const state=document.createElement('strong');state.textContent=labelFor(entry);state.style.color=toneFor(entry);const meta=document.createElement('span');meta.textContent=(entry.model||'模型未知')+(entry.status!=null?' · HTTP '+entry.status:'')+(entry.upstreamAttempts!=null?' · '+entry.upstreamAttempts+' 次':'');meta.style.cssText='min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c4c4c9';const time=document.createElement('time');time.textContent=formatTime(entry.endedAt||entry.startedAt);time.style.color='#8e8e94';row.append(state,meta,time);list.append(row);} panel.append(list);document.body.append(panel);
    const rect=button.getBoundingClientRect();panel.style.top=Math.max(12,Math.min(window.innerHeight-panel.offsetHeight-12,rect.bottom+8))+'px';panel.style.left=Math.max(12,Math.min(window.innerWidth-panel.offsetWidth-12,rect.right-panel.offsetWidth))+'px';setTimeout(()=>document.addEventListener('pointerdown',(event)=>{if(!panel.contains(event.target)&&event.target!==button)closePopover();},{once:true}),0);
  }

  function decorateTurns(threadId) {
    const visible=new Set();
    for(const turn of document.querySelectorAll('[data-content-search-turn-key]')){
      const turnId=String(turn.getAttribute('data-content-search-turn-key')||'').toLowerCase();if(!/^[0-9a-f-]{36}$/.test(turnId))continue;visible.add(turnId);
      const summary=summarizeTurn(snapshot,threadId,turnId),entry=summary.latest,bubble=turn.querySelector('[data-user-message-bubble]'),host=bubble?.parentElement;let badge=turn.querySelector('[data-codex-control-console-turn-state-turn]');
      if(!entry||!host){badge?.remove();continue;}if(!badge){badge=document.createElement('button');badge.type='button';badge.setAttribute('data-codex-control-console-turn-state-turn',turnId);badge.addEventListener('click',(event)=>{event.preventDefault();event.stopPropagation();openPopover(badge,summarizeTurn(snapshot,readThreadId(document),turnId),'本轮 · Turn State');});bubble.after(badge);}
      const label=labelFor(entry),color=toneFor(entry),signature=JSON.stringify([label,summary.entries.length,entry.endedAt,entry.status]);if(badge.dataset.signature!==signature){badge.textContent=label;badge.title='本轮真实响应的 turn state 长度；点击查看详情';badge.setAttribute('aria-label',badge.title);badge.style.cssText='align-self:flex-end;display:inline-flex;height:22px;align-items:center;padding:0 8px;border:1px solid '+color+'66;border-radius:999px;background:'+color+'18;color:'+color+';font:600 10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:pointer;opacity:.88;pointer-events:auto!important;-webkit-app-region:no-drag!important;app-region:no-drag!important;';badge.dataset.signature=signature;}
    }
    document.querySelectorAll('[data-codex-control-console-turn-state-turn]').forEach((badge)=>{if(!visible.has(badge.getAttribute('data-codex-control-console-turn-state-turn')))badge.remove();});
  }

  function renderGlobal() {
    const host=document.querySelector('header[data-app-shell-header-layout] [data-test-id="header-shell-slot"]')||document.querySelector('[data-test-id="header-shell-slot"]');if(!host)return;
    const summary=summarizeGlobal(snapshot);let button=document.querySelector('[data-codex-control-console-global-turn-state]');if(!button){button=document.createElement('button');button.type='button';button.setAttribute('data-codex-control-console-global-turn-state','');button.addEventListener('click',(event)=>{event.preventDefault();event.stopPropagation();openPopover(button,summarizeGlobal(snapshot),'全部会话 · Turn State');});}
    const latest=summary.latest,label=snapshot.available?(latest?labelFor(latest):'—'):'?',color=snapshot.available?toneFor(latest):'#a7a7ad',signature=JSON.stringify([label,summary.conversationCount,summary.counts,snapshot.observedAt]);if(button.dataset.signature!==signature){button.textContent=label;button.title='全局会话最近一次有效 turn state；点击查看各会话分布';button.setAttribute('aria-label',button.title);button.style.cssText='position:absolute;right:12px;top:50%;z-index:40;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:26px;padding:0 8px;border:1px solid '+color+'66;border-radius:999px;background:'+color+'18;color:'+color+';font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:pointer;opacity:.92;pointer-events:auto!important;-webkit-app-region:no-drag!important;app-region:no-drag!important;';button.dataset.signature=signature;}if(button.parentElement!==host)host.append(button);
  }

  function render() {
    const jev=document.querySelector('button[data-codex-control-console-native-jev-current]');const host=jev?.parentElement;if(!host)return;
    const threadId=readThreadId(document);const summary=summarize(snapshot,threadId);let button=document.querySelector('[data-codex-control-console-turn-state]');if(!button){button=document.createElement('button');button.type='button';button.setAttribute('data-codex-control-console-turn-state','');button.addEventListener('click',(event)=>{event.preventDefault();event.stopPropagation();openPopover(button,summarize(snapshot,readThreadId(document)));});}
    const latest=summary.latest;const label=snapshot.available?labelFor(latest):'?';const color=snapshot.available?toneFor(latest):'#a7a7ad';const signature=JSON.stringify([threadId,label,summary.entries.length,snapshot.observedAt]);if(button.dataset.signature!==signature){button.textContent=label;button.title=snapshot.available?(latest?'当前会话最近一次 turn state 长度；点击查看分布':'当前会话暂未观测到 turn state；点击查看详情'):'Router turn state 观测暂不可用';button.setAttribute('aria-label',button.title);button.style.cssText='display:inline-flex;position:relative;z-index:1;flex:0 0 auto;justify-content:center;align-items:center;height:28px;padding:0 9px;border:1px solid '+color+'66;border-radius:999px;background:'+color+'18;color:'+color+';font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:pointer;opacity:.9;pointer-events:auto!important;-webkit-app-region:no-drag!important;app-region:no-drag!important;';button.dataset.signature=signature;}
    if(button.parentElement!==host||button.previousElementSibling!==jev)jev.after(button);decorateTurns(threadId);renderGlobal();
  }
  window.__codexControlConsoleSetTurnStateSnapshot=(value)=>{snapshot=value&&Array.isArray(value.entries)?value:{available:false,observedAt:Date.now(),entries:[]};render();return true;};
  window.__codexControlConsoleTurnStateTimer=setInterval(render,700);render();
})()`;
}
