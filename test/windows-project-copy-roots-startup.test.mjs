import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const launcher = fileURLToPath(new URL('../scripts/start-windows.ps1', import.meta.url));
const quote = (value) => `'${value.replaceAll("'", "''")}'`;

test('Windows startup explicitly loads UTF-8 replica roots and clears omitted inherited roots', async () => {
  const text = await fs.readFile(launcher, 'utf8');
  assert.match(text, /Get-Content[^\n]+-Encoding UTF8/);
  assert.match(text, /PSObject\.Properties\['projectCopyRoots'\]/);
  assert.match(text, /Remove-Item Env:CODEX_CONTROL_PROJECT_COPY_ROOTS/);
  assert.match(text, /\$env:CODEX_CONTROL_PROJECT_COPY_ROOTS = \$copyRoots -join ';'/);
  assert.ok(text.indexOf('Windows projectCopyRoots must') < text.indexOf('$process = Start-Process'));
});

const cases = [
  {name: 'Unicode parent', roots: ['D:\\333.开发'], expected: 'D:\\333.开发'},
  {name: 'multiple parents', roots: ['D:\\333.开发', 'C:\\Projects'], expected: 'D:\\333.开发;C:\\Projects'},
  {name: 'omitted config clears inherited roots', omitted: true, expected: null},
  {name: 'empty list', roots: []},
  {name: 'explicit null', roots: null},
  {name: 'scalar', roots: 'D:\\Projects'},
  {name: 'blank member', roots: [' ']},
  {name: 'relative member', roots: ['Projects']},
  {name: 'drive relative member', roots: ['D:Projects']},
  {name: 'root relative member', roots: ['\\Projects']},
  {name: 'delimiter injection', roots: ['D:\\Projects;C:\\Secrets']},
  {name: 'newline injection', roots: ['D:\\Projects\nC:\\Secrets']},
  {name: 'null byte injection', roots: ['D:\\Projects\0']},
  {name: 'non-string member', roots: [7]}
];

for (const item of cases) test(`real Windows launcher handles ${item.name}`, {skip: process.platform !== 'win32'}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'replica-startup-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const applicationDirectory = path.join(root, 'application');
  await fs.mkdir(path.join(applicationDirectory, 'src'), {recursive: true});
  await fs.writeFile(path.join(applicationDirectory, 'src', 'main.mjs'), '');
  const nodeExecutable = path.join(root, 'fake-node.exe');
  await fs.writeFile(nodeExecutable, '');
  const config = {applicationDirectory, nodeExecutable, nodeId: 'startup-test', nodeName: '启动验收', nodeLocation: 'test'};
  if (!item.omitted) config.projectCopyRoots = item.roots;
  const configPath = path.join(root, 'config.json');
  await fs.writeFile(configPath, JSON.stringify(config), 'utf8');
  const command = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Start-Process {
  param($FilePath, $ArgumentList, $WorkingDirectory, $RedirectStandardOutput, $RedirectStandardError, [switch]$NoNewWindow, [switch]$PassThru)
  [Console]::WriteLine((@{roots=[Environment]::GetEnvironmentVariable('CODEX_CONTROL_PROJECT_COPY_ROOTS');launched=$true} | ConvertTo-Json -Compress))
  $result = New-Object PSObject -Property @{ExitCode=0}
  $result | Add-Member ScriptMethod WaitForExit {}
  return $result
}
& ${quote(launcher)} -ConfigPath ${quote(configPath)}
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
    encoding: 'utf8', timeout: 15000,
    env: {...process.env, LOCALAPPDATA: root, CODEX_CONTROL_PROJECT_COPY_ROOTS: 'C:\\InheritedWrongRoot'}
  });
  if ('expected' in item) {
    assert.equal(result.status, 0, result.stderr);
    const actual = JSON.parse(result.stdout.trim());
    assert.equal(actual.launched, true);
    assert.equal(actual.roots || null, item.expected);
  } else {
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /"launched":true/);
    assert.match(result.stderr, /Windows projectCopyRoots must/);
  }
});
