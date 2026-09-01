import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const brandMark = readFileSync("src/renderer/src/components/app/HydroBrandMark.tsx", "utf8");
const brandMarkSrc = readFileSync("src/renderer/src/components/app/brandMark.ts", "utf8");
const mark = readFileSync("src/renderer/src/components/app/LogoMark.tsx", "utf8");
const lockup = readFileSync("src/renderer/src/components/app/AppParts.tsx", "utf8");
const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const boot = readFileSync("src/renderer/index.html", "utf8");
const welcome = readFileSync(
  "src/renderer/src/components/session/HydroWelcomeHeader.tsx",
  "utf8",
);
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

// 上游 pi tetromino 点阵标（FINAL_LOGO 的 π 几何）与 PiDeck 字标都不得再出现在品牌面上。
const PI_GLYPH = /M165\.29 165\.29H517\.36V400/;

test("HydroBrandMark renders the shared HydroZagent logo tile", () => {
  // 唯一品牌标原语：渲染 brand-mark 图片，而不是内联水滴 SVG。
  assert.match(brandMark, /import \{ brandMarkSrc \} from "\.\/brandMark"/);
  assert.match(brandMark, /src=\{brandMarkSrc\}/);
  // brand-mark 与系统图标同源，由 make-icon 从 build/brand/logo.png 导出。
  assert.match(brandMarkSrc, /assets\/brand-mark\.png/);
});

test("all product brand surfaces use the shared HydroZagent mark", () => {
  assert.match(mark, /export function LogoMark/);
  assert.match(mark, /<HydroBrandMark/);
  assert.match(lockup, /<HydroBrandMark/);
  assert.match(lockup, /浙水智能体/);
  assert.match(app, /<HydroBrandMark/);
  assert.match(app, /t\("app\.brandName"\)/);
  // 启动页与新会话页用透明主标铺在各自水墨背景上。
  assert.match(boot, /hydrozagent-logo\.png/);
  assert.match(boot, /浙水智能体/);
  assert.match(welcome, /hydrozagent-logo\.png/);
  assert.match(webBrand, /<HydroBrandMark/);
  assert.match(webBrand, /t\("app\.brandName"\)/);
  assert.match(webTimeline, /<LogoMark size=\{66\} \/>/);
  assert.match(sessionSource, /export function HydroAgentLogo/);
  assert.match(composer, /<HydroAgentLogo/);
  assert.match(turnAuthor, /<HydroAgentLogo/);
});

test("no upstream pi tetromino glyph or PiDeck wordmark on brand surfaces", () => {
  for (const source of [
    brandMark,
    mark,
    lockup,
    app,
    boot,
    welcome,
    webBrand,
    webTimeline,
    sessionSource,
    composer,
    turnAuthor,
  ]) {
    assert.doesNotMatch(source, PI_GLYPH);
    assert.doesNotMatch(source, />\s*PiDeck\s*</);
  }
});
