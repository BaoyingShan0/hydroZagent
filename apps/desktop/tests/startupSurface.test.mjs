import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const bootHtml = readFileSync("src/renderer/index.html", "utf8");
const settingsStore = readFileSync("src/main/settings/SettingsStore.ts", "utf8");

test("boot surface ships the specified hydro backdrop with welcome-page treatment", () => {
  assert.ok(existsSync("src/renderer/src/assets/brand/boot-backdrop.png"));
  assert.match(bootHtml, /class="boot-backdrop"/);
  assert.match(bootHtml, /src="\/src\/assets\/brand\/boot-backdrop\.png"/);
  assert.match(bootHtml, /height:\s*42vh/);
  assert.match(bootHtml, /opacity:\s*0\.4/);
  assert.match(bootHtml, /mask-image:\s*linear-gradient\(to bottom, transparent 0%, #000 38%\)/);
});

test("new installations open the main window fullscreen by default", () => {
  assert.match(settingsStore, /startupWindowMode:\s*"fullscreen"/);
});
