import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNativeJevRoutingInjectionScript,
  NATIVE_JEV_ROUTING_BINDING,
  selectNativeJevRoutingTurn
} from "../src/native-jev-routing.mjs";

test("native Jev source installs the visible default-on switch", () => {
  const source = buildNativeJevRoutingInjectionScript();
  assert.match(source, /data-codex-control-console-native-jev/);
  assert.match(source, /data-codex-control-console-native-jev-current/);
  assert.match(source, /data-codex-control-console-native-jev-choice/);
  assert.match(source, /data-codex-control-console-jev-native-model-disabled/);
  assert.match(source, /data-composer-navigation-target="permissions"/);
  assert.match(source, /data-composer-navigation-target="reasoning"/);
  assert.match(source, /新建聊天继承全局 Jev 路由/);
  assert.match(source, /selectedThreadId \? await request\('set-thread-enabled'/);
  assert.match(source, /if \(!composerHost\) \{ current\?\.remove\(\); choice\?\.remove\(\); return; \}/);
  assert.match(source, /function renderGlobalButton\(button\)[\s\S]*?button\.replaceChildren\(icon\)/);
  assert.match(source, /function renderGlobalButton\(button\)[\s\S]*?createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', 'svg'\)/);
  assert.match(source, /button\.textContent = submissionPending \? '判断中…' : policy\.transportMode === 'native' \? '直连' : '路由';/);
  assert.doesNotMatch(source, /button\.textContent = 'Jev';/);
  assert.doesNotMatch(source, /Jev 全局/);
  assert.match(source, /'直连' : '路由'/);
  assert.match(source, /Jev 当前模型和推理强度/);
  assert.doesNotMatch(source, /Jev 自动 ·/);
  assert.match(source, /data-codex-control-console-jev-turn/);
  assert.match(source, /shared-mutation-events/);
  assert.doesNotMatch(source, /setInterval\(installButtons/);
  assert.match(source, /Jev 自动分流已开启/);
  assert.match(source, /addEventListener\('pointerup'/);
  assert.match(source, /pointer-events:auto!important/);
  assert.match(source, /data-codex-control-console-jev-routing-panel/);
  assert.match(source, /set-mappings/);
  assert.match(source, /addEventListener\('contextmenu'/);
  assert.match(source, /路由档位/);
  assert.match(source, /GPT-6 Luna/);
  assert.match(source, /GPT-6 Sol/);
  assert.match(source, /GPT-Reserve/);
  assert.match(source, /GPT-5\.5/);
  assert.match(source, /ignoreClickUntil/);
  assert.match(source, /flex:0 0 48px/);
  assert.match(source, /padding:0 6px/);
  assert.doesNotMatch(source, /flex:0 0 82px/);
  assert.match(source, /data-codex-control-console-jev-native-model-effective/);
  assert.match(source, /Jev 当前模型和推理强度/);
  assert.match(source, /color:#62bd84/);
  assert.match(source, /font:inherit/);
  assert.doesNotMatch(source, /style\.setProperty\('border-color'/);
  assert.match(source, /medium: '中'/);
  assert.match(source, /ultra: 'Ultra'/);
  assert.match(source, /child\.tagName === 'svg'/);
  assert.match(source, /inset:4px 28px 4px 8px/);
  assert.match(source, /'min-width', '145px'/);
  assert.match(source, /'right', '8px'/);
  assert.match(source, /native-arrow-style/);
  assert.match(source, /'color', '#62bd84'/);
  assert.match(source, /arrow\.style\.setProperty\('color', '#62bd84'/);
  assert.match(source, /__codexControlConsoleRouteNativeTurn/);
  assert.match(source, /document\.addEventListener\('keydown', interceptComposerKeydown, true\)/);
  assert.match(source, /document\.addEventListener\('click', interceptComposerClick, true\)/);
  assert.match(source, /policy\.transportMode === 'native' && policy\.available/);
  assert.doesNotMatch(selectNativeJevRoutingTurn.toString(), /THREAD_ID_PATTERN/);
  assert.match(source, new RegExp(NATIVE_JEV_ROUTING_BINDING));
});
