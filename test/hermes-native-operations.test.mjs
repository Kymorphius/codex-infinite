import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { HermesNativeOperations } from '../src/hermes-native-operations.mjs';
import { validateNativeAttachments, stageNativeAttachments } from '../src/native-composer-attachments.mjs';
const id = '00000000-0000-4000-8000-000000000001';
const sharedId = 'codex:' + id;
function fixture() {
  const calls = [];
  const native = { readPendingApprovals: async () => [], readThreadStatuses: async () => new Map(), resolveApproval: async p => calls.push(['approval', p]) };
  const source = { list: async () => ({ projects: [{ id, directories: [os.tmpdir()] }] }), find: async () => ({ id, title: 'before', archived: false }) };
  const service = new HermesNativeOperations({ source, native, settingsAdapter: { apply: async p => calls.push(['settings', p]) } });
  service.request = async (method, params) => { calls.push([method, params]); return method === 'model/list' ? { data: [{ id: 'model', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }] } : { thread: { id, name: 'after', model: 'model', reasoningEffort: 'low' } }; };
  return { service, native, calls };
}
test('create binds the selected native project and reports rename failure without creating twice', async () => {
  const { service, calls } = fixture();const request = service.request;
  service.request = async (method, p) => { if (method === 'thread/name/set') throw new Error('offline'); return request(method,p); };
  const result = await service.create({ project_id: sharedId, title: 'new' });
  assert.equal(result.id, sharedId);assert.ok(result.warning);assert.equal(calls.filter(c => c[0] === 'thread/start').length,1);
  assert.equal(calls[0][1].projectId,id);
  await assert.rejects(service.create({ project_id: 'codex:unknown' }), /不可用/);
});
test('settings reject invented models and archive rejects a running native turn', async () => {
  const { service, native, calls } = fixture();
  await assert.rejects(service.change(sharedId, { action: 'settings', model: 'invented', reasoningEffort: 'low' }), /无效/);
  assert.equal(calls.filter(c=>c[0]==='settings').length,0);
  await service.change(sharedId,{action:'settings',model:'model',reasoningEffort:'low'});
  assert.deepEqual(calls.find(c=>c[0]==='settings')[1].changes,{model:'model',reasoningEffort:'low'});
  native.readThreadStatuses=async()=>new Map([[id,'active']]);
  await assert.rejects(service.change(sharedId,{action:'archive'}),/等待/);
  assert.equal(calls.filter(c=>c[0]==='thread/archive').length,0);
});
test('approval forwards exact turn and token and propagates expiration',async()=>{
  const {service,native,calls}=fixture();
  await service.change(sharedId,{action:'approval',turnId:id,token:id,decision:'decline'});
  assert.deepEqual(calls.find(c=>c[0]==='approval')[1],{threadId:id,turnId:id,approvalToken:id,decision:'decline'});
  native.resolveApproval=async()=>{throw new Error('expired')};
  await assert.rejects(service.change(sharedId,{action:'approval',turnId:id,token:id,decision:'accept'}),/expired/);
});
test('attachment boundary rejects nonlocal inputs and protects an existing native attachment draft',async()=>{
  assert.throws(()=>validateNativeAttachments([{kind:'image',path:'https://example.com/a.png'}]),/无效/);
  assert.throws(()=>validateNativeAttachments(Array(9).fill({kind:'image',path:'/tmp/a.png'})),/最多/);
  let pasted=false;
  await assert.rejects(stageNativeAttachments({}, {evaluate:async expression=>{if(expression.includes('ClipboardEvent'))pasted=true;return false}},[]),/已有附件/);
  assert.equal(pasted,false);
});

test('creation accepts only directories owned by the selected shared project', async () => {
  const { service, calls } = fixture();
  service.source.list = async () => ({projects:[{id,directories:[os.tmpdir()]}],sessions:[
    {cwd:process.cwd(),shared_source:{projectId:id}},
    {cwd:'/',shared_source:{projectId:'other'}}
  ]});
  await service.create({project_id:sharedId,cwd:process.cwd()});
  assert.equal(calls[0][1].cwd,process.cwd());
  await assert.rejects(service.create({project_id:sharedId,cwd:'/'}),/不可用/);
  await assert.rejects(service.create({project_id:sharedId,cwd:42}),/不可用/);
  await assert.rejects(service.create({project_id:sharedId,cwd:null}),/不可用/);
  assert.equal(calls.filter(c=>c[0]==='thread/start').length,1);
});
