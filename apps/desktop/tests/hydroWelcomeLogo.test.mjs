import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  "src/renderer/src/components/session/HydroWelcomeHeader.tsx",
  "utf8",
);
// 与系统图标同源的透明主标；由 make-icon 从 build/brand/logo.png 生成。
const logoPath = "src/renderer/src/assets/brand/hydrozagent-logo.png";

test("new conversation surface uses the shared HydroZagent logo asset", () => {
  assert.ok(existsSync(logoPath));
  assert.ok(statSync(logoPath).size > 400_000);
  assert.match(component, /import welcomeLogo from "\.\.\/\.\.\/assets\/brand\/hydrozagent-logo\.png"/);
  assert.match(component, /src=\{welcomeLogo\}/);
  assert.match(component, /w-\[148px\][\s\S]*?mix-blend-multiply/);
  assert.doesNotMatch(component, /<LogoMark size=\{72\}/);
});
