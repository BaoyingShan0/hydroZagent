import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const rendererHtml = readFileSync("src/renderer/index.html", "utf8");
const mainSource = readFileSync("src/main/index.ts", "utf8");
const appSource = readFileSync("src/renderer/src/App.tsx", "utf8");
const viteSource = readFileSync("electron.vite.config.ts", "utf8");
const settingsLayout = readFileSync(
  "src/renderer/src/components/app/settings/settingsTabLayout.ts",
  "utf8",
);
const configModal = readFileSync("src/renderer/src/ConfigModal.tsx", "utf8");
const welcomeHeader = readFileSync(
  "src/renderer/src/components/session/HydroWelcomeHeader.tsx",
  "utf8",
);

test("hydroZagent brand identity is consistent across package and boot surface", () => {
  assert.equal(packageJson.name, "hydrozagent");
  assert.equal(packageJson.build.productName, "浙水智能体");
  assert.equal(packageJson.build.appId, "com.hydrozagent.app");
  assert.match(rendererHtml, /<strong class="boot-title">浙水智能体<\/strong>/);
  assert.match(rendererHtml, /AI 赋能水利 · 智慧守护江河/);
});

test("Windows runtime and tray use hydroZagent assets instead of Electron defaults", () => {
  assert.match(mainSource, /import iconPngPath from "\.\.\/\.\.\/build\/icon\.png\?asset"/);
  assert.match(mainSource, /import iconIcoPath from "\.\.\/\.\.\/build\/icon\.ico\?asset"/);
  assert.match(mainSource, /const windowIconPath = process\.platform === "win32" \? iconIcoPath : iconPngPath/);
  assert.match(mainSource, /app\.setName\("浙水智能体"\)/);
  assert.match(mainSource, /icon: windowIconPath/);
  assert.match(mainSource, /tray\.setToolTip\("浙水智能体"\)/);
});

test("welcome tagline and capability chips stay hidden above the composer", () => {
  assert.match(welcomeHeader, /<p hidden className=/);
  assert.match(welcomeHeader, /<div\s+hidden\s+className="mt-4 flex flex-wrap/);
});

test("lightweight distribution keeps pi and LAN Web while removing DSH and pet entry points", () => {
  assert.match(mainSource, /new CompositeAgentGateway\(\[agentManager\]\)/);
  assert.doesNotMatch(mainSource, /startDshHostInBackground\(/);
  assert.match(appSource, /defaultBackend: "pi"/);
  assert.doesNotMatch(configModal, /DshConfigTab/);
  assert.doesNotMatch(settingsLayout, /id: "pet"/);
  assert.doesNotMatch(viteSource, /pet: resolve\("src\/renderer\/pet\.html"\)/);
  assert.match(viteSource, /web: resolve\("src\/renderer\/web\.html"\)/);
  assert.doesNotMatch(JSON.stringify(packageJson.build.extraResources), /build\/pets/);
});
