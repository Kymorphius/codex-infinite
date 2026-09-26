import test from 'node:test';
import assert from 'node:assert/strict';
import {getConfig} from '../src/config.mjs';
test('macOS preserves the one-time native bootstrap while Windows prepares CSP with a reload',()=>{assert.equal(getConfig({},'/tmp/panel-startup','darwin').cspReloadRequired,false);assert.equal(getConfig({},'C:\\Users\\test','win32').cspReloadRequired,true);});
