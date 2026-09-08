import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeOpenLocalProjectInjectionScript, nativeOpenProjectCopy } from "../src/native-open-local-project.mjs";

test("open-project copy names the platform directory picker", () => {
  assert.deepEqual(nativeOpenProjectCopy("MacIntel"), { label: "打开本地项目", help: "从 Finder 选择文件夹并打开项目" });
  assert.deepEqual(nativeOpenProjectCopy("Win32"), { label: "打开本地项目", help: "从文件资源管理器选择文件夹并打开项目" });
  assert.deepEqual(nativeOpenProjectCopy("Linux x86_64"), { label: "打开本地项目", help: "选择文件夹并打开项目" });
});

test("native open-project injection delegates to the native local-project flow", () => {
  const source = buildNativeOpenLocalProjectInjectionScript();
  assert.match(source, /data-codex-control-console-open-local-project/);
  assert.match(source, /\['添加新项目', 'Add project', 'Create new project'\]/);
  assert.match(source, /\['本地', 'Local'\]/);
  assert.match(source, /\['下一步', 'Next'\]/);
  assert.match(source, /\['选择源文件夹', 'Select source folder'\]/);
  assert.match(source, /nativeAddProject\(\)/);
  assert.match(source, /trigger\.click\(\)/);
  assert.match(source, /local\.click\(\)/);
  assert.match(source, /next\.click\(\)/);
  assert.match(source, /sourceFolder\?\.click\(\)/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /document\.querySelector\('\[' \+ ENTRY \+ '\]'\)/);
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|showOpenFilePicker/);
  assert.doesNotThrow(() => new Function(source));
});
