import { BrowserWindow, ipcMain } from "electron";
import { execFile } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { readFile, writeFile, mkdir, access, constants as fsConstants, readdir, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import { ipcChannels } from "../../shared/ipc";

const execFileAsync = promisify(execFile);

type ZhichengDeps = {
	getMainWindow: () => BrowserWindow | null;
	userDataDir: string;
};

export function registerZhichengIpc({ getMainWindow, userDataDir }: ZhichengDeps): void {
	const SKILL_DIR = join(userDataDir, ".pi", "skills", "zhicheng-review");
	const SCRIPTS_DIR = join(SKILL_DIR, "scripts");
	const REPORTS_DIR = join(SKILL_DIR, "reports");
	const PROGRESS_FILE = join(SKILL_DIR, "progress.json");

	// Helper: ensure directory exists
	const ensureDir = async (dirPath: string) => {
		try {
			await mkdir(dirPath, { recursive: true });
		} catch {
			// Ignore if exists
		}
	};

	// Helper: get python script path
	const getScriptPath = (name: string) => join(SCRIPTS_DIR, name);

	// Helper: parse manifest CSV
	const parseManifest = async (manifestPath: string) => {
		const content = await readFile(manifestPath, "utf-8");
		const lines = content.split("\n").filter(l => l.trim());
		if (lines.length < 2) return [];

		const headers = lines[0].split(",");
		return lines.slice(1).map(line => {
			const values = line.split(",");
			const row: Record<string, string> = {};
			headers.forEach((h, i) => {
				row[h.trim()] = values[i] || "";
			});
			return row;
		});
	};

	// Helper: load progress (returns null if not exists)
	const loadProgress = async () => {
		try {
			const content = await readFile(PROGRESS_FILE, "utf-8");
			return JSON.parse(content);
		} catch {
			return null;
		}
	};

	// Helper: reset state (delete progress + reports)
	const resetState = async () => {
		try {
			// delete progress.json
			try { await access(PROGRESS_FILE, fsConstants.F_OK); await writeFile(PROGRESS_FILE, JSON.stringify({}), "utf-8"); }
			catch { /* ignore */ }
			// delete reports
			const entries = await readdir(REPORTS_DIR);
			for (const f of entries) {
				if (f.endsWith("_review.md") || f.endsWith("_issues.md")) {
					await unlink(join(REPORTS_DIR, f));
				}
			}
		} catch (err) {
			console.error("Reset state failed:", err);
		}
	};

	// Helper: push status to renderer
	const pushStatus = async (data: any) => {
		const win = getMainWindow();
		if (win && !win.isDestroyed()) {
			win.webContents.send(ipcChannels.zhichengStatusChanged, data);
		}
	};

	// 1. Check status
	ipcMain.handle(ipcChannels.zhichengCheckStatus, async () => {
		try {
			const manifestPath = join(SKILL_DIR, "manifest.csv");
			const manifestExists = await access(manifestPath, fsConstants.F_OK).then(() => true).catch(() => false);

			const progress = await loadProgress();
			const reportsCount = progress?.current || 0;

			// Load persons from manifest
			let persons = [];
			if (manifestExists) {
				const manifest = await parseManifest(manifestPath);
				const personMap = new Map();
				for (const row of manifest) {
					const pid = row["person_id"] || row["id"] || row["身份证"];
					const pname = row["person_name"] || row["name"] || row["姓名"];
					if (!personMap.has(pid)) {
						personMap.set(pid, {
							personId: pid,
							personName: pname,
							status: "pending" as const,
							issuesCount: 0,
						});
					}
				}
				persons = Array.from(personMap.values());
			}

			// Load ledger if exists
			let ledger = [];
			const ledgerPath = join(SKILL_DIR, "ledger.csv");
			const ledgerExists = await access(ledgerPath, fsConstants.F_OK).then(() => true).catch(() => false);
			if (ledgerExists) {
				const content = await readFile(ledgerPath, "utf-8");
				const lines = content.split("\n").filter(l => l.trim());
				if (lines.length > 1) {
					const headers = lines[0].split(",");
					ledger = lines.slice(1).map(line => {
						const values = line.split(",");
						const row: Record<string, string> = {};
						headers.forEach((h, i) => {
							row[h.trim()] = values[i] || "";
						});
						return row as any;
					});
				}
			}

			return {
				status: "ok",
				manifestPath: manifestExists ? manifestPath : null,
				reportsPath: REPORTS_DIR,
				ledgerPath: ledgerExists ? ledgerPath : null,
				// Step logic: manifest exists = downloaded = step 2, progress = reviewing/done = step 3, ledger = step 4
				currentStep: progress ? 3 : (manifestExists ? 2 : 1),
				reportsCount,
				persons,
				ledger,
			};
		} catch (error: any) {
			return { status: "error", error: error.message };
		}
	});

	// 1.5. Reset — clear all state (progress + reports)
	ipcMain.handle(ipcChannels.zhichengReset, async () => {
		try {
			await resetState();
			return { status: "ok" };
		} catch (error: any) {
			return { status: "error", error: error.message };
		}
	});

	// 2. Upload CSV
	ipcMain.handle(ipcChannels.zhichengUploadCsv, async (_event, fileData: { path: string; name: string; content: string }) => {
		try {
			const csvPath = join(userDataDir, basename(fileData.path));
			await writeFile(csvPath, fileData.content, "utf-8");

			return {
				status: "ok",
				filePath: csvPath,
			};
		} catch (error: any) {
			return { status: "error", error: error.message };
		}
	});

	// 3. Download (Phase 0) — upload local files via --upload-dir
	ipcMain.handle(ipcChannels.zhichengDownload, async (_event, options: { csvPath: string; workers?: number; retries?: number }) => {
		try {
			const { csvPath, workers = 8, retries = 3 } = options;

			const scriptPath = getScriptPath("download_from_oss.py");
			const outDir = join(SKILL_DIR, "materials");
			const manifestOutput = join(SKILL_DIR, "manifest.csv");

			await ensureDir(outDir);

			await execFileAsync("python", [
				scriptPath,
				"--upload-dir", dirname(csvPath),
				"--out", outDir,
				"--manifest", manifestOutput,
				"--workers", String(workers),
				"--retries", String(retries),
			], {
				cwd: SKILL_DIR,
				timeout: 3600000, // 1 hour timeout
			});

			const manifestExists = await access(manifestOutput, fsConstants.F_OK).then(() => true).catch(() => false);

			return {
				status: "ok",
				manifestPath: manifestExists ? manifestOutput : null,
			};
		} catch (error: any) {
			return { status: "error", error: error.message };
		}
	});

	// 4. Review (Phase 1)
	ipcMain.handle(ipcChannels.zhichengReview, async (_event, options: { persons?: string[] }) => {
		try {
			const { persons = ["all"] } = options;
			const manifestPath = join(SKILL_DIR, "manifest.csv");

			await ensureDir(REPORTS_DIR);

			const scriptPath = getScriptPath("review_slice.py");

			await execFileAsync("python", [
				scriptPath,
				"--manifest", manifestPath,
				"--persons",
				...persons,
			], {
				cwd: SKILL_DIR,
				timeout: 7200000, // 2 hour timeout
			});

			const progress = await loadProgress();
			const manifest = await parseManifest(manifestPath);
			const personMap = new Map();
			for (const row of manifest) {
				const pid = row["person_id"] || row["id"] || row["身份证"];
				const pname = row["person_name"] || row["name"] || row["姓名"];
				if (!personMap.has(pid)) {
					personMap.set(pid, {
						personId: pid,
						personName: pname,
						status: progress?.current > 0 ? "done" as const : "pending" as const,
						issuesCount: 0,
					});
				}
			}

			return {
				status: "ok",
				persons: Array.from(personMap.values()),
			};
		} catch (error: any) {
			return { status: "error", error: error.message };
		}
	});

	// 5. Generate ledger (Phase 2)
	ipcMain.handle(ipcChannels.zhichengLedger, async () => {
		try {
			await ensureDir(SKILL_DIR);

			const scriptPath = getScriptPath("build_summary.py");

			await execFileAsync("python", [
				scriptPath,
				"--reports-dir", REPORTS_DIR,
				"--out", join(SKILL_DIR, "ledger.csv"),
			], {
				cwd: SKILL_DIR,
				timeout: 600000, // 10 minute timeout
			});

			const ledgerPath = join(SKILL_DIR, "ledger.csv");
			const ledgerExists = await access(ledgerPath, fsConstants.F_OK).then(() => true).catch(() => false);

			let ledger = [];
			if (ledgerExists) {
				const content = await readFile(ledgerPath, "utf-8");
				const lines = content.split("\n").filter(l => l.trim());
				if (lines.length > 1) {
					const headers = lines[0].split(",");
					ledger = lines.slice(1).map(line => {
						const values = line.split(",");
						const row: Record<string, string> = {};
						headers.forEach((h, i) => {
							row[h.trim()] = values[i] || "";
						});
						return row as any;
					});
				}
			}

			return {
				status: "ok",
				ledgerPath: join(SKILL_DIR, "ledger.csv"),
				ledger,
			};
		} catch (error: any) {
			return { status: "error", error: error.message };
		}
	});
}