import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/renderer/src/hooks/useFileEditor.ts", "utf8");

test("file viewer IO callbacks are stable across App re-renders", () => {
  assert.match(app, /const readEditorFileContent = useCallback/);
  assert.match(app, /const readEditorOriginalContent = useCallback/);
  assert.match(app, /const saveEditorFileContent = useCallback/);
  assert.match(app, /readFileContent/);
  assert.match(app, /readGitOriginalContent/);
  assert.match(app, /writeFileContent/);
  assert.doesNotMatch(app, /readContent=\{\(path\) => api\.files\.readContent\(path\)\}/);
  assert.doesNotMatch(app, /readOriginalContent=\{\(path\) => api\.git\.originalContent\(path\)\}/);
  assert.doesNotMatch(app, /saveContent=\{\(path, content\) => api\.files\.writeContent\(path, content\)\}/);
});
