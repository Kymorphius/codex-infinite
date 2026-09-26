import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolveStaticAsset, serveStaticAsset } from '../src/static-assets.mjs';

test('terminal runtime serves only the three pinned browser assets', async () => {
  for (const url of ['/vendor/xterm.js', '/vendor/xterm-fit.js', '/vendor/xterm.css']) {
    const asset = resolveStaticAsset(url);
    assert.ok(asset?.path.includes('/node_modules/@xterm/'));
    assert.ok((await fs.stat(asset.path)).size > 0);
    let body, status;
    await serveStaticAsset({ method: 'GET', url }, {
      writeHead(code) { status = code; }, end(value) { body = value; }
    });
    assert.equal(status, 200);
    assert.ok(body.length > 0);
  }
  for (const url of ['/node_modules/node-pty/package.json', '/vendor/xterm.js.map',
    '/vendor/../package.json', '/vendor/%2e%2e/package.json', '/vendor/xterm.js/extra']) {
    assert.equal(resolveStaticAsset(url), null);
  }
});
