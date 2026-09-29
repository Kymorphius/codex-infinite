// Claude model picker in the terminal composer (shadow root). The pill follows the native
// composer's borderless model control; the menu copies .ccc-native-recent-menu (12px radius,
// primary background, 0 14px 42px shadow, blurred) and its 8px rows with a 9% hover fill.
const CHECK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2 5 8.6l4.5-5' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/12px no-repeat`;

export const NATIVE_TERMINAL_MODEL_PICKER_STYLE = `
/* The cap sits on the shrinkable wrapper, so the pill (and its ellipsis) follows the footer's real width. */
.model-picker{position:relative;display:flex;flex:0 1 auto;min-width:0;max-width:min(280px,42vw)}
.model-pill{flex:0 1 auto;max-width:100%;min-width:0;border-color:transparent;color:var(--muted)}
.model-pill:hover:not(:disabled),.model-pill[aria-expanded="true"]{background:#ffffff12;color:var(--fg)}
.model-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.model-pill[aria-expanded="true"]>svg{transform:rotate(180deg)}
.model-menu{position:absolute;right:0;bottom:calc(100% + 10px);z-index:6;display:flex;flex-direction:column;gap:1px;
  width:min(320px,calc(100vw - 32px));max-height:min(500px,calc(100vh - 140px));overflow:auto;overscroll-behavior:contain;padding:6px;
  border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:12px;background:var(--color-background-primary,#202022);
  color:var(--fg);box-shadow:0 14px 42px rgba(0,0,0,.28);backdrop-filter:blur(22px);font:400 12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.model-menu[hidden]{display:none}
.model-heading{padding:7px 8px 3px;color:var(--muted);font-size:11px;line-height:15px}
.model-row{display:flex;align-items:center;gap:9px;width:100%;flex:0 0 auto;border:0;border-radius:8px;padding:7px 8px;background:transparent;
  text-align:left;font:500 13px/17px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.model-row>span:first-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.model-row:hover:not(:disabled),.model-row:focus-visible{background:color-mix(in srgb,currentColor 9%,transparent);outline:none}
.model-row[role="menuitemradio"]::after{content:"";flex:0 0 12px;height:12px;background:currentColor;-webkit-mask:${CHECK};mask:${CHECK};visibility:hidden}
.model-row[aria-checked="true"]::after{visibility:visible}
.model-detail{display:block;color:var(--muted);font:400 11px/15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:normal}
.effort-seg{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:2px;margin:2px 4px 4px;padding:2px;border-radius:9px;
  background:color-mix(in srgb,currentColor 7%,transparent)}
.effort-seg>button{height:26px;min-width:0;border:0;border-radius:7px;padding:0 2px;background:transparent;color:var(--muted);font-size:12px}
.effort-seg>button:hover:not(:disabled){color:var(--fg)}
.effort-seg>button[aria-checked="true"]{background:color-mix(in srgb,currentColor 16%,transparent);color:var(--fg)}
.model-divider{flex:0 0 1px;margin:4px 6px;background:var(--line)}
.model-row.ultra>span:first-child{white-space:normal}
.switch{position:relative;flex:0 0 26px;height:16px;border-radius:999px;background:color-mix(in srgb,currentColor 20%,transparent);transition:background .15s ease}
.switch::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--fg);transition:transform .15s ease}
.ultra[aria-checked="true"] .switch{background:#3a82f7}.ultra[aria-checked="true"] .switch::after{transform:translateX(10px);background:#fff}
.model-note{margin:4px 8px 2px;color:var(--muted);font-size:11px;line-height:15px}.model-note[data-tone="bad"]{color:var(--bad)}
.model-picker[aria-busy="true"] .model-pill{opacity:.6}.model-menu [aria-disabled="true"]:not(:disabled){cursor:progress}
@media(prefers-reduced-motion:reduce){.switch,.switch::after{transition:none}}
@media(max-width:720px){.model-picker{max-width:150px}}
`;
