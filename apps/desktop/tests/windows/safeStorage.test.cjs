const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { build } = require("esbuild");
const electron = require("electron");

test("Windows Electron DPAPI saves, reads across processes, and clears credentials", { timeout: 90000 }, async () => {
	assert.equal(process.platform, "win32", "Explicit Windows acceptance requires Windows");
	const root = await mkdtemp(path.join(tmpdir(), "hydro-dpapi-test-"));
	try {
		const worker = path.join(root, "worker.cjs");
		await build({ entryPoints: [path.join(__dirname, "safeStorageWorker.ts")], outfile: worker,
			bundle: true, platform: "node", format: "cjs", external: ["electron"] });
		const pids = new Set();
		for (const operation of ["save", "load", "clear"]) {
			const result = path.join(root, `${operation}.json`);
			const env = { ...process.env };
			delete env.ELECTRON_RUN_AS_NODE;
			await new Promise((resolve, reject) => {
				const child = spawn(electron, [worker, root, operation, result], { env, windowsHide: true, stdio: "pipe" });
				let output = "";
				child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-8000); });
				const timer = setTimeout(() => { child.kill(); reject(new Error(`Electron ${operation} timed out`)); }, 25000);
				child.once("error", (error) => { clearTimeout(timer); reject(error); });
				child.once("exit", (code) => {
					clearTimeout(timer);
					if (code === 0) resolve(); else reject(new Error(`Electron ${operation} exited ${code}: ${output}`));
				});
			});
			const report = JSON.parse(await readFile(result, "utf8"));
			assert.equal(report.passed, true);
			pids.add(report.pid);
		}
		assert.equal(pids.size, 3);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
