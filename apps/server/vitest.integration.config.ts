import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.js";

// An explicitly requested database gate must never succeed by skipping every suite.
if (!process.env.HCS_TEST_DATABASE_URL) {
	throw new Error("HCS_TEST_DATABASE_URL is required for PostgreSQL integration tests");
}

export default mergeConfig(base, defineConfig({
	test: { include: ["test/integration/**/*.test.ts"] },
}));
