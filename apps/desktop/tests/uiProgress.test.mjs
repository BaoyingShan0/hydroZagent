import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const progress = readFileSync(
  "src/renderer/src/components/ui-shadcn/progress.tsx",
  "utf8",
);
const overlay = readFileSync(
  "src/renderer/src/components/overlays/AppUpdateOverlay.tsx",
  "utf8",
);
const surfaces = readFileSync("src/renderer/src/styles/surfaces.css", "utf8");

test("shadcn Progress exposes value through aria semantics", () => {
  assert.match(progress, /ProgressPrimitive\.Root/);
  // value 必须传给 Radix Root，由 Radix 生成 aria-valuenow；同时驱动 Indicator 位移。
  assert.match(progress, /value=\{value\}/);
  assert.match(progress, /bg-primary h-full w-full flex-1 transition-all/);
  assert.match(progress, /`translateX\(-\$\{100 - \(value \|\| 0\)\}%\)`/);
});

test("update overlay uses the shared Progress with an accessible label", () => {
  assert.match(overlay, /<Progress value=\{percent\} aria-label=\{t\("update\.downloadProgress"\)\}/);
  assert.doesNotMatch(overlay, /update-progress-bar/);
  assert.doesNotMatch(overlay, /style=\{\{ width: `\$\{Math\.max\(0, Math\.min\(100, percent\)\)\}%` \}\}/);
});

test("legacy update progress track CSS is removed", () => {
  assert.doesNotMatch(surfaces, /\.update-progress-track/);
  assert.doesNotMatch(surfaces, /\.update-progress-bar/);
  assert.match(surfaces, /\.update-progress-header,/);
});
