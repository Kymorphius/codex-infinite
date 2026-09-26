import { fileURLToPath } from 'node:url';

const packages = [
  ['/vendor/xterm.js', '@xterm/xterm/lib/xterm.js', 'text/javascript; charset=utf-8'],
  ['/vendor/xterm-fit.js', '@xterm/addon-fit/lib/addon-fit.js', 'text/javascript; charset=utf-8'],
  ['/vendor/xterm.css', '@xterm/xterm/css/xterm.css', 'text/css; charset=utf-8']
];

// Register individual package assets; never expose a node_modules directory.
export const terminalAssets = packages.map(([url, file, type]) => [url, {
  file, type, path: fileURLToPath(new URL(`../node_modules/${file}`, import.meta.url))
}]);
