import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const brandCss = readFileSync("src/renderer/src/styles/hydro-brand.css", "utf8");
const bootHtml = readFileSync("src/renderer/index.html", "utf8");
const appearance = readFileSync("src/renderer/src/themeAppearance.ts", "utf8");
const presets = readFileSync("src/renderer/src/themePresets.ts", "utf8");
const webMain = readFileSync("src/renderer/src/web-main.tsx", "utf8");
const brandSurfaces = [
  "src/renderer/index.html",
  "src/renderer/src/components/app/AppParts.tsx",
  "src/renderer/src/components/app/HydroBrandMark.tsx",
  "src/renderer/src/components/app/LogoMark.tsx",
  "src/renderer/src/components/session/HydroWelcomeHeader.tsx",
  "src/renderer/src/web/WebBrandLockup.tsx",
];

const BRAND_COLORS = new Set(["#5b6a76", "#6fafc0", "#c94f45", "#f7f8f7"]);
const NEUTRALS = new Set(["#fff", "#ffffff", "#000", "#000000"]);

function fixedColors(source) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  return [...withoutComments.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) => match[0].toLowerCase());
}

test("Hydro brand stylesheet has exactly four fixed chromatic colors", () => {
  const colors = new Set(fixedColors(brandCss));
  assert.deepEqual(
    [...colors].filter((color) => !NEUTRALS.has(color)).sort(),
    [...BRAND_COLORS].sort(),
  );
  assert.match(brandCss, /--hydro-qing:\s*#5b6a76/);
  assert.match(brandCss, /--hydro-lake:\s*#6fafc0/);
  assert.match(brandCss, /--hydro-vermilion:\s*#c94f45/);
  assert.match(brandCss, /--hydro-rice:\s*#f7f8f7/);
});

test("brand surfaces do not introduce hard-coded colors outside the brand contract", () => {
  for (const file of brandSurfaces) {
    const colors = fixedColors(readFileSync(file, "utf8"));
    for (const color of colors) {
      assert.ok(BRAND_COLORS.has(color) || NEUTRALS.has(color), `${file}: ${color}`);
    }
  }
});

test("brand typography collapses to the 28/20/14/12 specification", () => {
  for (const value of ["12px", "14px", "20px", "28px"]) {
    assert.match(brandCss, new RegExp(`font-size-[a-z-]+:\\s*${value.replace("px", "px")}`));
  }
  for (const forbidden of ["11px", "13px", "15px", "16px", "18px", "36px"]) {
    assert.doesNotMatch(brandCss, new RegExp(`font-size-[a-z-]+:\\s*${forbidden}`));
  }
});

test("Source Han Sans variable font and OFL license ship with the renderer", () => {
  const font = "src/renderer/src/assets/fonts/SourceHanSansCN-VF.woff2";
  const license = "src/renderer/src/assets/fonts/SourceHanSans-LICENSE.txt";
  assert.ok(existsSync(font));
  assert.ok(statSync(font).size > 1_000_000);
  assert.ok(existsSync(license));
  assert.match(readFileSync(license, "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/i);
  assert.match(brandCss, /SourceHanSansCN-VF\.woff2/);
  assert.match(brandCss, /font-display:\s*swap/);
  assert.match(brandCss, /font-weight:\s*200 900/);
});

test("Hydro brand stays light while preserving stored theme preferences", () => {
  // 缺省 themeSkin 一律兜底 classic-green，避免 data-appearance 失配退回 foundation 浅色默认。
  assert.match(appearance, /settings\.themeSkin \|\| "classic-green"/);
  assert.match(appearance, /skin === "classic-green" \? "light" : resolvedTheme/);
  assert.match(webMain, /dataset\.appearance = "classic-green"/);
  assert.match(webMain, /dataset\.theme = "light"/);
  assert.doesNotMatch(webMain, /prefers-color-scheme/);
});

test("desktop index.html boots on the classic-green brand baseline", () => {
  assert.match(bootHtml, /<html[^>]*data-appearance="classic-green"/);
  assert.match(bootHtml, /<html[^>]*data-theme="light"/);
});

test("boot and theme preview reuse the same four brand colors", () => {
  const classicPreview = presets.match(/id: "classic-green"[\s\S]*?\n\t\},\n\t\{/i)?.[0] ?? "";
  assert.ok(classicPreview);
  for (const source of [bootHtml, classicPreview]) {
    const chromatic = fixedColors(source).filter((color) => !NEUTRALS.has(color));
    for (const color of chromatic) assert.ok(BRAND_COLORS.has(color), color);
  }
  assert.match(presets, /background: "#f7f8f7"/);
  assert.match(presets, /sidebar: "#5b6a76"/);
  assert.match(presets, /accent: "#6fafc0"/);
});
