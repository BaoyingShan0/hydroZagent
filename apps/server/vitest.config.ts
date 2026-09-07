import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		exclude: [...configDefaults.exclude, "test/windows/**"],
		clearMocks: true,
		coverage: { enabled: false },
		testTimeout: 20_000,
	},
});
