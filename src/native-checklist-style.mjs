export function nativeChecklistStyles() {
  const icon = body => 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>') + '")';
  const addIcon = icon('<path d="M12 5v14M5 12h14"/>');
  const searchIcon = icon('<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>');
  return `
    [data-ccc-checklist]{position:fixed;inset:0;margin:auto;width:min(760px,calc(100vw - 40px));max-height:82vh;padding:22px;border:1px solid #8885;border-radius:18px;background:var(--color-background-primary,#252525);color:var(--color-text,#eee);box-shadow:0 24px 80px #0008;font:14px/1.5 system-ui}
    [data-ccc-checklist]::backdrop{background:#0006}
    [data-ccc-checklist][open]{display:flex;flex-direction:column;gap:10px}
    [data-ccc-checklist] header{display:flex;align-items:center;justify-content:space-between;gap:16px;order:0}
    [data-ccc-checklist] [data-checklist-controls]{display:contents}
    [data-ccc-checklist] [data-checklist-controls] p{order:1}
    [data-ccc-checklist] form{order:2}[data-ccc-checklist] [data-checklist-search]{order:3}
    [data-ccc-checklist] > :not(header):not(form):not([data-checklist-controls]){order:4}
    [data-ccc-checklist] form,[data-ccc-checklist] [data-checklist-search]{display:flex;align-items:center;gap:8px;padding:5px 8px;border:0;border-radius:11px;background:#8881;min-height:38px}
    [data-ccc-checklist] form:focus-within,[data-ccc-checklist] [data-checklist-search]:focus-within{outline:1px solid #aaa8}
    [data-ccc-checklist] form::before,[data-ccc-checklist] [data-checklist-search]::before{content:'';flex:none;width:18px;height:18px;background:var(--color-text-secondary,#aaa)}
    [data-ccc-checklist] form::before{-webkit-mask:${addIcon} center/contain no-repeat;mask:${addIcon} center/contain no-repeat}
    [data-ccc-checklist] [data-checklist-search]::before{-webkit-mask:${searchIcon} center/contain no-repeat;mask:${searchIcon} center/contain no-repeat}
    [data-ccc-checklist] [data-checklist-search] small{white-space:nowrap}[data-ccc-checklist] [hidden]{display:none}
    [data-ccc-checklist] h2{font-size:18px;margin:0;font-weight:650}[data-ccc-checklist] p{color:#aaa;margin:0;overflow-wrap:anywhere}
    [data-ccc-checklist] button{cursor:pointer;border:0;border-radius:8px;padding:5px 10px;background:#8882;color:inherit}
    [data-ccc-checklist] button:hover{background:#8883}
    [data-ccc-checklist] select{min-width:150px;max-width:240px;border:0;border-radius:7px;padding:5px 8px;background:#8882;color:inherit}
    [data-ccc-checklist] input[type=text],[data-ccc-checklist] input[type=search],[data-ccc-checklist] textarea{min-width:0;flex:1;border:0;border-radius:7px;background:#8881;color:inherit;padding:8px}
    [data-ccc-checklist] form input,[data-ccc-checklist] [data-checklist-search] input{border:0;background:transparent;outline:0;padding:4px 2px}
    [data-ccc-checklist] form button{background:#8882}
    [data-ccc-checklist] textarea{font:inherit;line-height:1.4;field-sizing:content;min-height:34px;max-height:128px;overflow-y:auto;resize:vertical;padding:5px 8px;background:transparent}
    [data-ccc-checklist] textarea:focus-visible{outline:1px solid #aaa8;background:#8881}
    [data-ccc-checklist] ul{list-style:none;padding:0;padding-inline-start:48px;margin:2px 0;max-height:45vh;overflow:auto;display:flex;flex-direction:column;gap:5px;counter-reset:task}
    [data-ccc-checklist][data-claim=true] ul{padding-inline-end:88px}
    [data-ccc-checklist] li{display:flex;align-items:center;gap:4px 10px;padding:7px 9px;flex-wrap:wrap;border:0;border-radius:10px;background:#8881}
    [data-ccc-checklist] li[data-checklist-row]{counter-increment:task;position:relative}
    [data-ccc-checklist] li[data-checklist-row]::before{content:counter(task);position:absolute;inset-inline-start:-44px;top:50%;transform:translateY(-50%);display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:32px;height:34px;border-radius:9px;background:#8882;font-size:11px;font-variant-numeric:tabular-nums;color:#aaa}
    [data-ccc-checklist] li[data-checklist-claim-row]>button{position:absolute;inset-inline-end:-76px;top:50%;transform:translateY(-50%);box-sizing:border-box;width:64px;height:34px;display:flex;align-items:center;justify-content:center}
    [data-ccc-checklist] li textarea{min-width:min(220px,100%)}
    [data-ccc-checklist] [data-checklist-added]{order:-1;flex:none;margin-inline-end:8px;white-space:nowrap;font-size:11px;color:#999;line-height:1.2}
    [data-ccc-checklist] li[data-done=true] textarea{text-decoration:line-through;opacity:.55}
    [data-ccc-checklist] li[data-ccc-held-todo]{align-items:flex-start;background:#8882}[data-ccc-checklist] li[data-ccc-held-todo] input{flex:1}[data-ccc-checklist] li[data-ccc-held-todo] small{margin-inline-end:auto}
    [data-ccc-checklist] [data-checklist-count]{padding-top:5px;font-size:12px}
    [data-ccc-checklist] small{display:block;color:#999}[data-ccc-checklist] button:disabled{opacity:.4;cursor:default}
  `;
}
