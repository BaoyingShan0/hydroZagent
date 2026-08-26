import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = join(repositoryRoot, "apps", "desktop");
const cliPath = join(repositoryRoot, "packages", "coding-agent", "dist", "cli.js");
const desktopVitePath = join(desktopRoot, "node_modules", "electron-vite", "bin", "electron-vite.js");

if (!existsSync(cliPath)) {
	console.error("未找到本仓库 Agent 运行时，请先执行：npm run desktop:prepare");
	process.exit(1);
}

if (!existsSync(desktopVitePath)) {
	console.error("未安装桌面端依赖，请先执行：npm --prefix apps/desktop install --ignore-scripts");
	process.exit(1);
}

const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["--prefix", "apps/desktop", "run", "dev"], {
	cwd: repositoryRoot,
	stdio: "inherit",
	env: {
		...process.env,
		HYDROZAGENT_PI_CLI_PATH: cliPath,
		HYDROZAGENT_NODE_EXECUTABLE: process.execPath,
	},
});

child.on("error", (error) => {
	console.error("启动浙水智能体桌面端失败：", error);
	process.exit(1);
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 0);
});
