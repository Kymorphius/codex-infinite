export const NATIVE_HELD_QUEUE_STYLE = `[data-ccc-held-queue-button],[data-ccc-save-draft-todo],[data-ccc-claim-task]{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;border:1px solid rgba(128,128,128,.25);border-radius:999px;background:transparent;color:currentColor;font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:pointer}
[data-ccc-held-queue-button][data-warning=true]{border-color:rgba(220,80,70,.6);color:#d9534f}
[data-ccc-save-draft-todo]:disabled{opacity:.35;cursor:default}
[data-ccc-held-queue-panel]{margin:8px 8px 0;padding:8px;border:1px solid rgba(128,128,128,.22);border-radius:12px;background:color-mix(in srgb,Canvas 94%,transparent);color:CanvasText;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
[data-ccc-held-queue-panel][hidden]{display:none}
[data-ccc-held-head],[data-ccc-held-row],[data-ccc-held-actions],[data-ccc-held-views]{display:flex;align-items:center;gap:6px}
[data-ccc-held-head]{justify-content:space-between;margin-bottom:6px}
[data-ccc-held-list]{display:flex;max-height:210px;flex-direction:column;gap:4px;overflow:auto}
[data-ccc-held-row]{min-width:0;padding:5px 6px;border-radius:8px;background:rgba(128,128,128,.09)}
[data-ccc-held-row][data-editing=true]{align-items:flex-start}
[data-ccc-held-kind]{flex:none;color:#777}
[data-ccc-held-text]{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-ccc-held-editor]{min-width:0;flex:1;padding:6px 8px;border:1px solid rgba(128,128,128,.32);border-radius:8px;background:Canvas;color:CanvasText;font:inherit;line-height:1.45;resize:vertical}
[data-ccc-held-actions]{flex:none}
[data-ccc-held-actions] button,[data-ccc-held-views] button,[data-ccc-held-sync]{padding:2px 6px;border:1px solid rgba(128,128,128,.25);border-radius:6px;background:transparent;color:inherit;cursor:pointer}
[data-ccc-held-actions] button:disabled{opacity:.35;cursor:default}
[data-ccc-held-views] button:disabled{border-color:currentColor;background:rgba(128,128,128,.16);opacity:1;cursor:default}
[data-ccc-held-warning]{margin:0 0 6px;color:#d9534f}
[data-ccc-held-empty]{padding:10px;text-align:center;color:#777}`;
