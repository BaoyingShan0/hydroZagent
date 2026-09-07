import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import { ManagedCredentialStore } from "../../src/main/managed/credentialStore";
import { windowsSystemEncryption } from "../../src/main/managed/systemEncryption";

const [profile, operation, resultPath] = process.argv.slice(2);
app.setPath("userData", profile);
app.whenReady().then(async () => {
	assert.equal(process.platform, "win32");
	assert.equal(windowsSystemEncryption.isAvailable(), true);
	const path = join(profile, "managed-credentials.json");
	const store = new ManagedCredentialStore(path, windowsSystemEncryption);
	const credential = {
		accessToken: "fake-access-token-for-dpapi-verification",
		refreshToken: "fake-refresh-token-for-dpapi-verification",
		accessExpiresAt: 4102444800000,
		user: { id: "fake-user", username: "dpapi-test", role: "user" as const, is_self_reported: true },
	};
	if (operation === "save") {
		await store.save(credential);
		const bytes = await readFile(path);
		for (const value of [credential.accessToken, credential.refreshToken, credential.user.username]) {
			assert.equal(bytes.includes(value), false);
		}
	} else if (operation === "load") {
		assert.deepEqual(await store.load(), credential);
	} else if (operation === "clear") {
		await store.clear();
		assert.equal(existsSync(path), false);
		assert.equal(await store.load(), null);
	} else {
		throw new Error("Unknown credential test operation");
	}
	await writeFile(resultPath, JSON.stringify({ operation, passed: true, pid: process.pid }));
	app.quit();
}).catch((error: unknown) => {
	console.error(error);
	app.exit(1);
});
