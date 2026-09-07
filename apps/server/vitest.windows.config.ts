import { defineConfig } from "vitest/config";

if (process.platform !== "win32") throw new Error("Packaged Windows acceptance requires Windows");
for (const key of ["HCS_TEST_DATABASE_URL", "HCS_TEST_PKI_DIR", "HCS_TEST_DESKTOP_EXE"]) {
	if (!process.env[key]) throw new Error(`Packaged Windows acceptance requires ${key}`);
}
export default defineConfig({
	test: { include: ["test/windows/*.test.mjs"], testTimeout: 120000, hookTimeout: 60000, fileParallelism: false },
});
