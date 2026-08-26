import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mark = readFileSync("src/renderer/src/components/app/LogoMark.tsx", "utf8");
const lockup = readFileSync("src/renderer/src/components/app/AppParts.tsx", "utf8");
const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const boot = readFileSync("src/renderer/index.html", "utf8");
const webBrand = readFileSync("src/renderer/src/web/WebBrandLockup.tsx", "utf8");
const webTimeline = readFileSync("src/renderer/src/web/WebTimeline.tsx", "utf8");
const sessionSource = readFileSync(
  "src/renderer/src/components/session/SessionSourceBadge.tsx",
  "utf8",
);
const composer = readFileSync(
  "src/renderer/src/components/session/ComposerComponents.tsx",
  "utf8",
);
const turnAuthor = readFileSync(
  "src/renderer/src/components/session/turn/TurnAuthorHeader.tsx",
  "utf8",
);

const PI_GLYPH = /M165\.29 165\.29H517\.36V400/;

test("all product brand surfaces use the hydroZagent water mark", () => {
  assert.match(mark, /export function LogoMark/);
  assert.match(mark, /<HydroBrandMark/);
  assert.match(lockup, /<HydroBrandMark size=\{22\}/);
  assert.match(lockup, /浙水智能体/);
  assert.match(app, /<HydroBrandMark size=\{120\}/);
  assert.match(app, /t\("app\.brandName"\)/);
  assert.match(boot, /#c94f45/);
  assert.match(boot, /M60 17c-13 18-29 34/);
  assert.match(webBrand, /<HydroBrandMark size=\{22\}/);
  assert.match(webBrand, /t\("app\.brandName"\)/);
  assert.match(webTimeline, /<LogoMark size=\{66\} \/>/);
  assert.match(sessionSource, /export function HydroAgentLogo/);
  assert.match(composer, /<HydroAgentLogo/);
  assert.match(turnAuthor, /<HydroAgentLogo/);
  for (const source of [mark, lockup, app, boot, webBrand, webTimeline, sessionSource, composer, turnAuthor]) {
    assert.doesNotMatch(source, PI_GLYPH);
    assert.doesNotMatch(source, />\s*PiDeck\s*</);
  }
});
