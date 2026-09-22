import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeContextInjectionScript } from '../src/native-context-injection.mjs';
import { createNativeClaimTaskBridge } from '../src/native-claim-task-control.mjs';
import { createNativeSaveDraftTodoButton } from '../src/native-save-draft-control.mjs';
import { buildNativeJevRoutingInjectionScript } from '../src/native-jev-routing.mjs';
import { buildNativeTurboInjectionScript } from '../src/native-turbo-injection.mjs';

test('native composer controls use compact labels without changing their actions', () => {
  const context = buildNativeContextInjectionScript();
  assert.match(context, /button\.textContent = '百万'/);
  assert.doesNotMatch(context, /data-context-toggle-dot/);
  assert.match(context, /permission\.style\.setProperty\('display', 'none', 'important'\)/);
  assert.match(context, /permission\.setAttribute\('aria-hidden', 'true'\)/);

  assert.match(createNativeSaveDraftTodoButton.toString(), /存待办/);
  assert.match(buildNativeContextInjectionScript(), /order:3/);
  assert.match(createNativeClaimTaskBridge.toString(), /领任务/);
  assert.match(createNativeClaimTaskBridge.toString(), /指派任务/);
  assert.match(createNativeClaimTaskBridge.toString(), /指派给已有会话/);
  assert.match(createNativeClaimTaskBridge.toString(), /order:2/);

  const jev = buildNativeJevRoutingInjectionScript();
  assert.match(jev, /'直连' : '路由'/);
  assert.match(jev, /order:4/);
  assert.doesNotMatch(jev, /'Jev 原生' : 'Jev 路由'/);

  const turbo = buildNativeTurboInjectionScript();
  assert.doesNotMatch(turbo, /addSelect\(form, '访问权限'/);
  assert.doesNotMatch(turbo, /'完全访问'/);
});
