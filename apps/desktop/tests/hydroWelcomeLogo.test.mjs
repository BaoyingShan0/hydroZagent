import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  "src/renderer/src/components/session/HydroWelcomeHeader.tsx",
  "utf8",
);
const logoPath = "src/renderer/src/assets/brand/HydroZagent_logo_idea1_no_words.png";

test("new conversation surface uses the proposed HydroZagent logo asset", () => {
  assert.ok(existsSync(logoPath));
  assert.ok(statSync(logoPath).size > 800_000);
  assert.match(component, /import welcomeLogo from "\.\.\/\.\.\/assets\/brand\/HydroZagent_logo_idea1_no_words\.png"/);
  assert.match(component, /src=\{welcomeLogo\}/);
  assert.match(component, /w-\[148px\][\s\S]*?mix-blend-multiply/);
  assert.doesNotMatch(component, /<LogoMark size=\{72\}/);
});
