import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function createDesktopDevInvocation({
	repositoryPath = repositoryRoot,
	nodeExecutable = process.execPath,
	environment = process.env,
} = {}) {
	const desktopRoot = join(repositoryPath, "apps", "desktop");
	const cliPath = join(repositoryPath, "packages", "coding-agent", "dist", "cli.js");
	const desktopDevScript = join(desktopRoot, "scripts", "dev.js");
	const childEnvironment = {
		...environment,
		HYDROZAGENT_PI_CLI_PATH: cliPath,
		HYDROZAGENT_NODE_EXECUTABLE: nodeExecutable,
	};
	delete childEnvironment.ELECTRON_RUN_AS_NODE;

	return {
		command: nodeExecutable,
		args: [desktopDevScript],
		cwd: desktopRoot,
		env: childEnvironment,
		cliPath,
		desktopDevScript,
		desktopVitePath: join(desktopRoot, "node_modules", "electron-vite", "bin", "electron-vite.js"),
	};
}

export function runDesktopDev() {
	const invocation = createDesktopDevInvocation();
	if (!existsSync(invocation.cliPath)) {
		console.error("未找到本仓库 Agent 运行时，请先执行：npm run desktop:prepare");
		process.exit(1);
	}

	if (!existsSync(invocation.desktopVitePath)) {
		console.error("未安装桌面端依赖，请先执行：npm --prefix apps/desktop install --ignore-scripts");
		process.exit(1);
	}

	const child = spawn(invocation.command, invocation.args, {
		cwd: invocation.cwd,
		stdio: "inherit",
		env: invocation.env,
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
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	runDesktopDev();
}
