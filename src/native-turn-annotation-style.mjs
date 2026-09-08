export const TURN_ANNOTATION_STYLE = `
[data-ccc-annotation-layout]{margin-inline-end:320px!important;min-width:0!important}
[data-ccc-annotated] [class*="MarkerLine"]{background:#a78bfa!important;box-shadow:0 0 0 1px #a78bfa55}
[data-ccc-annotated]{--navigation-rail-marker-color:#a78bfa}
[data-ccc-annotations]{position:fixed;right:12px;top:88px;bottom:auto;height:min(420px,calc(100vh - 104px));width:296px;box-sizing:border-box;z-index:55;display:flex;flex-direction:column;gap:12px;padding:16px;border:0;border-radius:25px;background:var(--color-surface-elevated-secondary,#2d2d2d);color:var(--color-text,#eee);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-app-region:no-drag}
[data-ccc-annotations][hidden],[data-ccc-annotation-toggle][hidden],[data-ccc-annotation-preview][hidden]{display:none!important}
[data-ccc-annotations] header{display:flex;align-items:center;justify-content:space-between;font-size:15px;font-weight:600}
[data-ccc-annotations] button,[data-ccc-annotation-toggle]{cursor:pointer;border:0;border-radius:6px;padding:5px 9px;background:color-mix(in srgb,currentColor 7%,transparent);color:inherit;font:inherit}
[data-ccc-annotations] [data-ccc-annotation-collapse]{width:20px;height:20px;padding:0;flex-shrink:0;border:0;background:transparent;font-size:14px;font-weight:400;line-height:20px;opacity:.45}
[data-ccc-annotations] [data-ccc-annotation-collapse]:hover,[data-ccc-annotations] [data-ccc-annotation-collapse]:focus-visible{opacity:1}
[data-ccc-annotations] select,[data-ccc-annotations] textarea{color:inherit;background:transparent;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:6px;padding:8px;font:inherit;width:100%;box-sizing:border-box}
[data-ccc-annotations] textarea{flex:1;min-height:100px;resize:none;line-height:1.7}
[data-ccc-annotations] option{color:var(--color-text,#eee);background:var(--color-background-primary,#202022)}
[data-ccc-annotations] small{opacity:.7}
[data-ccc-annotation-toggle]{position:fixed;right:14px;top:90px;z-index:55;color:var(--color-text,#eee);background:var(--color-background-primary,#202022);border:1px solid #8885;-webkit-app-region:no-drag}
[data-ccc-annotation-output-host]{max-height:var(--ccc-annotation-output-limit)!important}
[data-ccc-annotation-preview-host]{margin-bottom:var(--ccc-annotation-height,0px)!important}
[data-ccc-annotation-preview]{position:fixed;z-index:2147483100;box-sizing:border-box;pointer-events:none}
[data-ccc-annotation-preview] strong{display:block;font-weight:500;margin-bottom:4px}
[data-ccc-annotation-preview] div{white-space:pre-wrap;overflow:hidden;display:-webkit-box;-webkit-line-clamp:8;-webkit-box-orient:vertical;overflow-wrap:anywhere}
@media(max-width:850px){[data-ccc-annotation-layout]{margin-inline-end:0!important}[data-ccc-annotations]{max-width:calc(100vw - 48px)}}
`;
