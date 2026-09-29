import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRouterTurnStateSnapshot } from '../src/router-turn-state-service.mjs';
import { normalizeNativeTurnStateSnapshot, buildNativeTurnStateInjectionScript } from '../src/native-turn-state-status.mjs';
import { renderNativeReasoningAdjustment } from '../src/native-request-observation.mjs';

const threadId = '01a0c463-6db9-7672-92d6-62b6367c3114';
const other = '01a0c463-6db9-7672-92d6-62b6367c3115';
function harness() {
  let badge;
  const parent = {}, host = { parentElement: parent, after(value) { badge = value; value.parentElement = parent; } };
  const doc = { querySelector: selector => selector.startsWith('button') ? host : badge,
    createElement: () => ({ setAttribute() {}, style: {}, remove() { badge = undefined; } }) };
  return { doc, badge: () => badge };
}
const adjusted = { threadId, startedAt: 10, requestedReasoningEffort: 'ultra', effectiveReasoningEffort: 'high' };

test('active request observation survives both normalization boundaries without response headers', () => {
  const service = normalizeRouterTurnStateSnapshot({ active: [{ ...adjusted, nativePreparationMs: 9,
    nativeRequestBytes: 5000, nativeUploadBytes: 900, secret: 'private' }] });
  const snapshot = normalizeNativeTurnStateSnapshot(service);
  assert.equal(snapshot.entries[0].effectiveReasoningEffort, 'high');
  assert.equal(snapshot.entries[0].nativeUploadBytes, 900);
  assert.deepEqual(snapshot.entries[0].turnState, { present: false });
  assert.doesNotMatch(JSON.stringify(snapshot), /private|secret/);
  const invalid = normalizeNativeTurnStateSnapshot(normalizeRouterTurnStateSnapshot({ active: [{ ...adjusted,
    effectiveReasoningEffort: 'secret', nativePreparationMs: -1 }] }));
  assert.equal(invalid.entries[0].effectiveReasoningEffort, undefined);
  assert.equal(invalid.entries[0].nativePreparationMs, undefined);
});

test('adjustment appears only for latest current-thread request and clears on normal, switching, unavailable', () => {
  const h = harness();
  const render = (entries, id = threadId, available = true) => renderNativeReasoningAdjustment({ entries, available }, id, h.doc);
  render([adjusted]);
  assert.equal(h.badge().textContent, '推理 ultra → high');
  assert.match(h.badge().title, /路由实际发送/);
  const original = h.badge(); render([adjusted]); assert.equal(h.badge(), original);
  render([adjusted, { ...adjusted, startedAt: 11, requestedReasoningEffort: 'high' }]);
  assert.equal(h.badge(), undefined);
  render([adjusted]); render([adjusted], other); assert.equal(h.badge(), undefined);
  render([adjusted]); render([adjusted], threadId, false); assert.equal(h.badge(), undefined);
  render([adjusted, { threadId, startedAt: 12 }]); assert.equal(h.badge(), undefined);
  render([adjusted, { ...adjusted, threadId: other, startedAt: 13 }]);
  assert.equal(h.badge().textContent, '推理 ultra → high');
});

test('render helper is embedded in updated injection without external dependencies', () => {
  const script = buildNativeTurnStateInjectionScript();
  assert.match(script, /2026-09-29\.1/);
  assert.match(script, /renderReasoningAdjustment\(snapshot,readThreadId\(document\)\)/);
  new Function(script);
});
