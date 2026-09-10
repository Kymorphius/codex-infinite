import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

test('read-only inventory includes archived members and descendants but excludes cwd-only history', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'clone-inventory-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const setup = `import sqlite3,json,sys,pathlib
home=pathlib.Path(sys.argv[1])
(home/'.codex-global-state.json').write_text(json.dumps({'local-projects':{'project':{'name':'Clone','rootPaths':['/root']}},'thread-project-assignments':{'main':{'projectId':'project'}}}))
c=sqlite3.connect(home/'state_5.sqlite')
c.execute('create table threads(id,rollout_path,cwd,title,name,archived,source,project_id)')
for tid,parent in [('main',None),('child','main'),('grandchild','child'),('unrelated',None)]:
 folder=home/('archived_sessions' if tid=='main' else 'sessions')
 folder.mkdir(exist_ok=True)
 file=folder/(tid+'.jsonl')
 file.write_text(json.dumps({'type':'session_meta','payload':{'id':tid,'timestamp':'2026-09-01T00:00:00Z'}})+'\\n'+tid+' body\\n')
 source=json.dumps({'subagent':{'thread_spawn':{'parent_thread_id':parent}}}) if parent else '"cli"'
 c.execute('insert into threads values(?,?,?,?,?,?,?,?)',(tid,str(file),'/root',tid,None,int(tid=='main'),source,None))
c.commit()
c.close()
`;
  execFileSync('python3', ['-c', setup, home]);
  const db = path.join(home, 'state_5.sqlite');
  const before = await fs.readFile(db);
  const manifest = JSON.parse(execFileSync('python3', ['scripts/inspect-project-clone.py'], { input: JSON.stringify({ codexHome: home, projectId: 'project' }) }));
  assert.deepEqual(manifest.sessions.map(session => session.sourceThreadId), ['child', 'grandchild', 'main']);
  assert.equal(manifest.sessions.filter(session => session.isProjectThread).length, 1);
  assert.equal(manifest.sessions.find(session => session.sourceThreadId === 'main').archived, true);
  assert.equal(manifest.sessions[0].bodySha256, createHash('sha256').update('child body\n').digest('hex'));
  assert.deepEqual(await fs.readFile(db), before);
});
