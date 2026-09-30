export function buildNativeJevRoutingPanelSource() {
  return `
  const ROUTE_TIER_OPTIONS = [
    ['instant', '即时'], ['quick', '轻快'], ['everyday', '日常'], ['substantial', '进阶'],
    ['complex', '复杂'], ['deep', '深度'], ['critical', '关键'], ['extreme', '极限']
  ];
  const ROUTE_MODEL_OPTIONS = [
    ['gpt-6.1-sol', 'GPT-6.1 Sol'],
    ['gpt-6-luna', 'GPT-6 Luna'], ['gpt-6-sol', 'GPT-6 Sol'], ['gpt-6-astra', 'GPT-6 Astra'], ['gpt-reserve', 'GPT-Reserve'],
    ['gpt-5.6-luna', 'GPT-5.6 Luna'], ['gpt-5.6-terra', 'GPT-5.6 Terra'], ['gpt-5.6-sol', 'GPT-5.6 Sol'], ['gpt-5.5', 'GPT-5.5']
  ];
  const ROUTE_EFFORT_OPTIONS = [
    ['low', '轻度'], ['medium', '中'], ['high', '高'], ['xhigh', '极高'], ['max', '最高'], ['ultra', 'Ultra']
  ];
  const ROUTE_MODEL_EFFORTS = {
    'gpt-6.1-sol': ['low','medium','high','xhigh','max','ultra'],
    'gpt-6-luna': ['low','medium','high','xhigh','max'], 'gpt-6-sol': ['low','medium','high','xhigh','max','ultra'], 'gpt-6-astra': ['low','medium','high','xhigh','max','ultra'],
    'gpt-reserve': ['low','medium','high','xhigh','max'], 'gpt-5.6-luna': ['low','medium','high','xhigh','max'], 'gpt-5.6-terra': ['low','medium','high','xhigh','max','ultra'],
    'gpt-5.6-sol': ['low','medium','high','xhigh','max','ultra'], 'gpt-5.5': ['low','medium','high','xhigh']
  };
  const ROUTE_DEFAULT_MAPPINGS = {
    instant: ['gpt-5.6-luna', 'low'], quick: ['gpt-5.6-luna', 'medium'], everyday: ['gpt-5.6-terra', 'medium'], substantial: ['gpt-5.6-terra', 'high'],
    complex: ['gpt-5.6-sol', 'high'], deep: ['gpt-5.6-sol', 'xhigh'], critical: ['gpt-6-astra', 'xhigh'], extreme: ['gpt-6-astra', 'ultra']
  };

  function closeRoutingPanel() {
    document.querySelector('[data-codex-control-console-jev-routing-panel]')?.remove();
  }

  function openRoutingPanel(anchor) {
    const existing = document.querySelector('[data-codex-control-console-jev-routing-panel]');
    if (existing) { closeRoutingPanel(); return; }
    const panel = document.createElement('div');
    panel.setAttribute('data-codex-control-console-jev-routing-panel', '');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '路由档位配置');
    panel.style.cssText = 'position:fixed;z-index:2147483646;width:min(520px,calc(100vw - 24px));max-height:min(680px,calc(100vh - 24px));overflow:auto;padding:15px;border:1px solid rgba(106,190,138,.42);border-radius:14px;background:rgb(35,35,37);color:#f2f2f2;box-shadow:0 16px 46px rgba(0,0,0,.38);font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-app-region:no-drag;app-region:no-drag;';
    const heading = document.createElement('div'); heading.style.cssText = 'display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:12px';
    const title = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = '路由档位'; strong.style.cssText = 'display:block;font-size:14px';
    const note = document.createElement('small'); note.textContent = '为每个任务阶级指定模型和推理强度，保存后所有会话共用。'; note.style.cssText = 'display:block;margin-top:3px;color:#a8a8ad;font-size:11px;line-height:1.4'; title.append(strong, note);
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭'; close.style.cssText = 'height:28px;padding:0 8px;border:1px solid #505055;border-radius:7px;background:transparent;color:#d2d2d6;font:600 11px inherit;cursor:pointer'; close.addEventListener('click', closeRoutingPanel); heading.append(title, close);
    const form = document.createElement('form'); form.style.cssText = 'display:grid;gap:7px';
    const columns = document.createElement('div'); columns.style.cssText = 'display:grid;grid-template-columns:minmax(72px,1fr) minmax(146px,1.55fr) minmax(90px,1fr);gap:7px;padding:0 5px;color:#a8a8ad;font-size:10px';
    for (const text of ['阶级', '模型', '推理强度']) { const column = document.createElement('span'); column.textContent = text; columns.append(column); }
    form.append(columns);
    const fields = new Map();
    const createSelect = (options, value) => { const select = document.createElement('select'); select.style.cssText = 'width:100%;height:32px;padding:0 7px;border:1px solid #505055;border-radius:8px;background:#2d2d30;color:#f4f4f5;font:12px inherit;'; for (const [optionValue, label] of options) { const option = document.createElement('option'); option.value = optionValue; option.textContent = label; option.selected = optionValue === value; select.append(option); } return select; };
    for (const [tier, label] of ROUTE_TIER_OPTIONS) {
      const current = policy.mappings?.[tier] || {}; const fallback = ROUTE_DEFAULT_MAPPINGS[tier];
      const row = document.createElement('div'); row.style.cssText = 'display:grid;grid-template-columns:minmax(72px,1fr) minmax(146px,1.55fr) minmax(90px,1fr);align-items:center;gap:7px;padding:7px;border:1px solid rgba(255,255,255,.08);border-radius:9px;background:rgba(255,255,255,.035);';
      const tierLabel = document.createElement('strong'); tierLabel.textContent = label; tierLabel.style.cssText = 'font-size:12px;color:#d9d9dd';
      const model = createSelect(ROUTE_MODEL_OPTIONS, current.model || fallback[0]);
      const effort = createSelect(ROUTE_EFFORT_OPTIONS, current.effort || fallback[1]);
      const syncEfforts = () => { const selected = effort.value; const supported = ROUTE_MODEL_EFFORTS[model.value] || []; const allowed = ROUTE_EFFORT_OPTIONS.filter(([value]) => supported.includes(value)); const next = supported.includes(selected) ? selected : allowed.at(-1)?.[0]; effort.textContent = ''; for (const [value, optionLabel] of allowed) { const option = document.createElement('option'); option.value = value; option.textContent = optionLabel; option.selected = value === next; effort.append(option); } };
      model.addEventListener('change', syncEfforts); syncEfforts(); row.append(tierLabel, model, effort); form.append(row); fields.set(tier, { model, effort });
    }
    const status = document.createElement('div'); status.setAttribute('role', 'status'); status.style.cssText = 'min-height:16px;padding:0 2px;color:#f0b866;font-size:11px'; form.append(status);
    const save = document.createElement('button'); save.type = 'submit'; save.textContent = '保存路由配置'; save.style.cssText = 'height:36px;border:1px solid rgba(106,190,138,.64);border-radius:9px;background:rgba(75,166,110,.2);color:#70cc94;font:700 12px inherit;cursor:pointer'; form.append(save);
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); if (save.disabled) return;
      const mappings = Object.fromEntries(ROUTE_TIER_OPTIONS.map(([tier]) => { const field = fields.get(tier); return [tier, { model: field.model.value, effort: field.effort.value }]; }));
      save.disabled = true; save.textContent = '正在保存…'; status.textContent = '';
      try { const response = await request('set-mappings', { mappings }, 8000); applySnapshot(response.snapshot); closeRoutingPanel(); installButtons(); }
      catch (error) { status.textContent = String(error?.message || error); save.disabled = false; save.textContent = '保存路由配置'; }
    });
    panel.append(heading, form); document.body.append(panel);
    const rect = anchor.getBoundingClientRect(); panel.style.top = Math.max(12, Math.min(window.innerHeight - panel.offsetHeight - 12, rect.bottom + 8)) + 'px'; panel.style.left = Math.max(12, Math.min(window.innerWidth - panel.offsetWidth - 12, rect.right - panel.offsetWidth)) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', (event) => { if (!panel.contains(event.target) && event.target !== anchor) closeRoutingPanel(); }, { once: true }), 0);
  }
`;
}
