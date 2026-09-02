const { execFileSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
for (const name of ["HYDRO_HCS_BASE_URL", "HYDRO_HCS_CA_BUNDLE_PATH"]) {
	if (!process.env[name]) throw new Error(`Managed distribution requires ${name}`);
}
const environment = { ...process.env, HYDRO_MANAGED_BUILD: "1" };

console.log("[1/2] 构建 Windows 受管代码与固定信任材料…");
execFileSync("npm.cmd", ["run", "build"], { cwd: root, stdio: "inherit", env: environment });

console.log("[2/2] 生成独立受管安装包…");
execFileSync(
	"npx.cmd",
	[
		"electron-builder",
		"--config=electron-builder.managed.cjs",
		"--win",
		"nsis",
		"zip",
		"--config.productName=浙水智能体受管版",
		"--config.appId=com.hydrozagent.managed",
		"--config.win.artifactName=hydroZagent-managed-${version}-win.${ext}",
		"--config.nsis.artifactName=hydroZagent-managed-${version}-setup.${ext}",
	],
	{ cwd: root, stdio: "inherit", env: environment },
);
