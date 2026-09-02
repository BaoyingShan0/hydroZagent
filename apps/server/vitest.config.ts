import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		clearMocks: true,
		coverage: { enabled: false },
		testTimeout: 20_000,
	},
});
