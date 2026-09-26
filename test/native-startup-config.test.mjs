import test from 'node:test';
import assert from 'node:assert/strict';
import {getConfig} from '../src/config.mjs';
test('desktop attachment prepares CSP with one reload before loopback frames',()=>{assert.equal(getConfig({},'/tmp/panel-startup','darwin').cspReloadRequired,true);assert.equal(getConfig({},'C:\\Users\\test','win32').cspReloadRequired,true);});
