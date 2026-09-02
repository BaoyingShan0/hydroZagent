import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { isManagedSettingImmutable } = loadTsCommonJs("src/main/managed/settingsPolicy.ts");

test("managed settings policy locks runtime, alternate model, and network channels", () => {
	for (const key of [
		"customPiPath",
		"wslEnabled",
		"webServiceEnabled",
		"dshHostPath",
		"feishuEnabled",
		"visionProvider",
		"imagegenProvider",
		"piRpcOffline",
		"piProxyUrl",
		"desktopProxyUrl",
		"defaultAgentBackend",
		"gitCommitMessageProvider",
		"gitCommitMessageModel",
		"telemetryEnabled",
	]) {
		assert.equal(isManagedSettingImmutable(key), true, `setting must be immutable: ${key}`);
	}
	for (const key of ["theme", "language", "fontSize", "enableNotifications"]) {
		assert.equal(isManagedSettingImmutable(key), false, `presentation setting should remain mutable: ${key}`);
	}
});

test("managed bootstrap forces Chromium sandbox and suppresses product telemetry", () => {
	const source = readFileSync("src/main/index.ts", "utf8");
	assert.match(source, /MANAGED_BUILD\.managed\s*\|\|\s*readElectronChromiumSandboxPreference\(\)/);
	assert.match(source, /if\s*\(!MANAGED_BUILD\.managed\)\s*sendTelemetryHeartbeat\(\)/);
});
