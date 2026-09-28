import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { installNativeTerminalClient } from './native-terminal-client.mjs';
import { installNativeTerminalView } from './native-terminal-view.mjs';
import { NATIVE_TERMINAL_VIEW_STYLE } from './native-terminal-view-style.mjs';
import { createTerminalSession } from '../public/features/terminal/session.js';
import { terminalMessage, terminalStatus } from '../public/features/terminal/presentation.js';
const asset = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = [installNativeTerminalClient, installNativeTerminalView, createTerminalSession, terminalMessage, terminalStatus].map(fn => fn.toString()).join('\n');
const viewStyle = NATIVE_TERMINAL_VIEW_STYLE;
const version = createHash('sha256').update(source + viewStyle).digest('hex').slice(0, 12);
const vendor = asset('../node_modules/@xterm/xterm/lib/xterm.js') + '\n' + asset('../node_modules/@xterm/addon-fit/lib/addon-fit.js');
const css = asset('../node_modules/@xterm/xterm/css/xterm.css');
export async function prepareNativeTerminalRuntime(connection) {
  if (await connection.evaluate(`window.__cccTerminalNativeVersion === ${JSON.stringify(version)} && Boolean(window.__cccTerminalNative)`)) return;
  await connection.evaluate(`(() => { (function(module,exports,define) { ${vendor}\n }).call(globalThis);\n${source}\ninstallNativeTerminalClient(); installNativeTerminalView(createTerminalSession, terminalStatus, ${JSON.stringify(css + viewStyle)}); window.__cccTerminalNativeVersion = ${JSON.stringify(version)}; window.__cccNativeTerminalView?.remount?.(); })()`);
}
