// Shadow-root styles for the native terminal conversation. Native theme tokens inherit
// through the shadow boundary; fallbacks keep the dark native appearance.
export const NATIVE_TERMINAL_VIEW_STYLE = `
:host{--fg:var(--color-text,#ececf1);--muted:var(--color-text-tertiary,#ffffff80);--line:var(--color-border,#ffffff16);
  --surface:#2c2c2e;--raised:#3a3a3d;--page:var(--color-codex-terminal-background,#171719);
  --ok:#3fb27f;--wait:#d9a640;--bad:#ef6b64;color:var(--fg);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}
button{font:inherit;color:inherit;cursor:pointer}button:disabled{opacity:.38;cursor:default}
button:focus-visible,summary:focus-visible{outline:2px solid color-mix(in srgb,var(--fg) 55%,transparent);outline-offset:1px}
.layout{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;background:var(--page);padding:10px 22px 14px}
.bar{display:flex;align-items:center;gap:10px;min-height:34px;padding:0 2px 8px;border-bottom:1px solid var(--line)}
.bar strong{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40%}
.chip{flex:0 0 auto;padding:1px 8px;border-radius:999px;font-size:11px;line-height:18px;color:#e5b532;background:#e5b5321f;border:1px solid #e5b53240}
.chip[hidden]{display:none}.chip[data-kind="shell"]{color:#8fb6ea;background:#8fb6ea1c;border-color:#8fb6ea3d}
.cwd{flex:1;min-width:0;color:var(--muted);font:11px/18px "SF Mono",SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.launch{flex:0 0 auto;border:0;border-radius:999px;padding:5px 13px;background:var(--fg);color:var(--page);font-size:12px;font-weight:600}
.launch[hidden]{display:none}.launch[data-armed]{background:var(--bad);color:#fff}
.output{flex:1;min-height:0;overflow:hidden;padding:10px 0 6px}
/* xterm measures each glyph repeated 32 times; Chrome trims adjacent fullwidth punctuation
   to half width there, so a lone '，' would get extra letter-spacing and push the row edge. */
.xterm{text-spacing-trim:space-all}
/* Composer metrics mirror the native ChatGPT composer (_ComposerLayoutRoot_): #363636, 22px
   radius, 1px inset hairline, 14/20 text with 12px inset, 28px pills, 8px footer inset, 5px gaps. */
.composer{flex:0 0 auto;display:flex;flex-direction:column;gap:6px;padding:16px 8px 8px;border:0;border-radius:22px;
  background:#363636;box-shadow:inset 0 0 1px #ffffff33}
textarea{display:block;resize:none;width:100%;min-height:44px;max-height:200px;border:0;outline:0;padding:0 12px;background:transparent;color:inherit;
  font:14px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;scrollbar-width:thin}
textarea::placeholder{color:var(--muted)}
footer{display:flex;align-items:center;gap:5px;min-width:0}
.pill{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;height:28px;border:1px solid #80808040;border-radius:999px;padding:0 9px;background:transparent;font-size:12px}
.pill:hover:not(:disabled),.keys[open]>.pill{background:#ffffff12}
.pill>svg{opacity:.7;transition:transform .15s ease}.keys[open]>.pill>svg{transform:rotate(180deg)}.pill kbd{font:10px/1 "SF Mono",Menlo,monospace;color:var(--muted)}
.keys{position:relative}.keys[data-disabled]>.pill{opacity:.38;pointer-events:none}.keys>summary{list-style:none}.keys>summary::-webkit-details-marker{display:none}
.menu{position:absolute;left:0;bottom:calc(100% + 10px);z-index:5;display:grid;gap:8px;width:220px;padding:10px;border:1px solid var(--line);border-radius:14px;
  background:var(--raised);box-shadow:0 12px 32px #0006}
.menu>span{padding:0 2px;color:var(--muted);font-size:11px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
.grid>button{height:30px;border:1px solid var(--line);border-radius:8px;background:#ffffff0a;font-size:12px}
.grid>button:hover:not(:disabled),.menu>.paste:hover:not(:disabled){background:#ffffff1c}
.menu>.paste{height:32px;border:0;border-top:1px solid var(--line);border-radius:0 0 8px 8px;padding-top:6px;background:transparent;text-align:left;font-size:12px}
.status{flex:1;display:flex;align-items:center;justify-content:flex-end;gap:6px;min-width:0;color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.status::before{content:"";flex:0 0 7px;height:7px;border-radius:50%;background:var(--muted)}
.status[data-tone="ok"]::before{background:var(--ok)}.status[data-tone="wait"]::before{background:var(--wait);animation:pulse 1.2s ease-in-out infinite}
.status[data-tone="held"]::before{background:var(--wait)}.status[data-tone="bad"]{color:var(--bad)}.status[data-tone="bad"]::before{background:var(--bad)}
.send{position:relative;flex:0 0 32px;display:grid;place-items:center;width:32px;height:32px;margin-left:4px;border:0;border-radius:50%;padding:0;background:var(--fg);color:var(--page)}
.send:disabled{opacity:.3}.send[data-sending="true"]>svg{opacity:0}
.send[data-sending="true"]::after{content:"";position:absolute;width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(1turn)}}@keyframes pulse{50%{opacity:.35}}
@media(prefers-reduced-motion:reduce){.status::before,.send::after{animation:none!important}}
@media(max-width:720px){.layout{padding:8px 10px 10px}.pill kbd,.cwd{display:none}.composer{padding:8px 6px 6px}}
`;
