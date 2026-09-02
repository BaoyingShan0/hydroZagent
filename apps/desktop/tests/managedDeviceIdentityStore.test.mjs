import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const { ManagedDeviceIdentityStore } = loadTsCommonJs("src/main/managed/deviceIdentityStore.ts");

test("managed device identity is stable per installation and repairs a malformed envelope", async () => {
	const root = await mkdtemp(join(tmpdir(), "hydrozagent-managed-device-"));
	const path = join(root, "managed", "device-identity.json");
	try {
		const store = new ManagedDeviceIdentityStore(path);
		const first = await store.loadOrCreate();
		assert.match(first, UUID_PATTERN);
		assert.equal(await store.loadOrCreate(), first);
		assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { v: 1, deviceId: first });

		await writeFile(path, JSON.stringify({ v: 1, deviceId: "renderer-controlled" }), "utf8");
		const repaired = await store.loadOrCreate();
		assert.match(repaired, UUID_PATTERN);
		assert.notEqual(repaired, first);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
