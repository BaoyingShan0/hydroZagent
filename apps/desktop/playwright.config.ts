import { defineConfig } from "@playwright/test";

/**
 * Playwright Electron E2E 配置（UI 2.0 / issue #115 U6）。
 *
 * 运行模型：
 * - 起真实应用（out/main/index.js，先 npm run build:fast），不依赖 Vite dev server；
 * - 每个 worker 用临时 APPDATA/XDG_CONFIG_HOME 隔离 userData，不碰本机真实数据；
 * - 不启动 pi Agent 的用例不需要 mock pi；需要 pi 的场景走 e2e:real（本地真 pi，不进默认门禁）。
 */
export default defineConfig({
	testDir: "./e2e",
	timeout: 60_000,
	expect: { timeout: 10_000 },
	// Electron 单实例锁按 userData 隔离；worker 间 userData 已分开，可并行
	workers: 1,
	retries: 0,
	reporter: [["list"]],
	use: {
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
});
