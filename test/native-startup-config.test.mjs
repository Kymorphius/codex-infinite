import test from 'node:test';
import assert from 'node:assert/strict';
import {getConfig} from '../src/config.mjs';
test('macOS initial attachment does not force a native window reload',()=>{assert.equal(getConfig({},'/tmp/panel-startup','darwin').cspReloadRequired,false);assert.equal(getConfig({},'C:\\Users\\test','win32').cspReloadRequired,true);});
