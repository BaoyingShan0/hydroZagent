/**
 * zhicheng-review Extension — Batch pre-screening pipeline for 职称评审 materials.
 *
 * Orchestrates three phases:
 *   Phase 0: Download OSS-attached PDFs (calls download_from_oss.py)
 *   Phase 1: Per-applicant review (calls phase1_review.py)
 *   Phase 2: Aggregate ledger (calls phase2_ledger.py)
 *
 * Provides tools for the LLM agent to call, a /zhicheng-review command,
 * and a progress widget that updates in real-time.
 *
 * All model calls are routed internally (hekou-lab). No external routing.
 */

import { Type } from "typebox";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { join, basename, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Resolve extension directory (works with jiti CommonJS transpilation)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_DIR = join(__dirname, "..", "skills", "zhicheng-review");
const SCRIPTS_DIR = join(SKILL_DIR, "scripts");
const PROGRESS_FILE = join(SKILL_DIR, "progress.json");
const REPORTS_DIR = join(SKILL_DIR, "reports");
const MANIFEST_FILE = join(SKILL_DIR, "manifest.json");
const UPLOAD_DIR = join(SKILL_DIR, "uploads");
// Supported file extensions for batch upload
const SUPPORTED_EXTENSIONS = [
	".pdf", ".doc", ".docx", ".xls", ".xlsx",
	".ppt", ".pptx", ".txt", ".jpg", ".jpeg", ".png",
	".bmp", ".tiff", ".webp",
];

let activeTask: ChildProcess | null = null;
let widgetLines: string[] = [];

/** Read manifest.json; returns manifest data */
function readManifest(): Record<string, unknown> {
	if (!existsSync(MANIFEST_FILE)) return {};
	try {
		return JSON.parse(readFileSync(MANIFEST_FILE, "utf-8"));
	} catch {
		return {};
	}
}

/** Write manifest.json */
function writeManifest(data: Record<string, unknown>): void {
	try {
		writeFileSync(MANIFEST_FILE, JSON.stringify(data, null, 2), "utf-8");
	} catch {
		// ignore
	}
}

/** Read progress.json; returns last-known state */
function readProgress(): Record<string, unknown> {
	if (!existsSync(PROGRESS_FILE)) return {};
	try {
		return JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
	} catch {
		return {};
	}
}

/** Write progress.json */
function writeProgress(data: Record<string, unknown>): void {
	try {
		writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2), "utf-8");
	} catch {
		// ignore
	}
}

/** Poll progress.json and update widget every 2s */
let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPolling(): void {
	if (pollTimer) clearInterval(pollTimer);
	pollTimer = setInterval(() => {
		const progress = readProgress();
		const status = (progress.status as string) || "";
		const current = (progress.current as number) || 0;
		const total = (progress.total as number) || 0;
		const details = (progress.details as string) || "";

		if (!status) return;

		let bar = "░░░░░░░░░░";
		if (total > 0) {
			const pct = Math.min(10, Math.round((current / total) * 10));
			bar = "█".repeat(pct) + "░".repeat(10 - pct);
		}

		widgetLines = [
			`职称评审 pipeline: ${status}`,
			`${bar} ${current}/${total}`,
			details ? details.slice(0, 60) : "",
		];
	}, 2000);
}

function stopPolling(): void {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
}

/** Spawn a Python script and return its stdout as a string */
function spawnPython(script: string, args: string[], timeoutSec = 600): Promise<{ ok: boolean; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn("python", [script, ...args], {
			cwd: SKILL_DIR,
			encoding: "utf-8" as never,
			timeout: timeoutSec * 1000,
		});

		let stdout = "";
		let stderr = "";

		child.stdout?.on("data", (d: Buffer) => {
			stdout += d.toString();
		});
		child.stderr?.on("data", (d: Buffer) => {
			stderr += d.toString();
		});
		child.on("close", (code) => {
			resolve({ ok: code === 0, stdout, stderr });
		});
		child.on("error", (err) => {
			resolve({ ok: false, stdout, stderr: err.message });
		});
		activeTask = child;
	});
}

export default function (pi: ExtensionAPI) {
	// ── Register tools ────────────────────────────────────────────────────

	// Batch file upload tool — supports multiple formats
	pi.registerTool({
		name: "zhicheng_upload_files",
		label: "Upload Review Materials (Batch)",
		description: "Upload one or more files for 职称评审 review. Supports batch upload of "
			+ "PDF, Word (doc/docx), Excel (xls/xlsx), images, and other formats. "
			+ "Files are stored locally and a manifest.json is auto-generated for subsequent phases.",
		promptSnippet: "Upload files: zhicheng_upload_files",
		parameters: Type.Object({}),
		async execute(_toolCallId) {
			// This tool is meant to be called with file attachments from the UI.
			// The LLM agent should instruct the user to upload files via the chat UI.
			const uploadDir = UPLOAD_DIR;
			const manifest = readManifest();
			const files = (manifest.files as any[]) || [];
			const totalSize = files.reduce((sum: number, f: any) => sum + (f.size || 0), 0);

			return {
				content: [{
					type: "text",
					text: `# 职称评审材料上传\n\n` +
						`请通过聊天界面直接拖拽或点击上传按钮上传文件。支持以下格式：\n\n` +
						`**支持的文件格式：**\n` +
						SUPPORTED_EXTENSIONS.map(ext => `- ${ext.toUpperCase()}`).join("\n") + `\n\n` +
						`**已上传 ${files.length} 个文件，总大小 ${(totalSize / 1024 / 1024).toFixed(2)} MB**\n\n` +
						`**上传目录：** ${uploadDir}\n\n` +
						`**上传方式：**\n` +
						`1. 直接在聊天中拖入文件（支持批量）\n` +
						`2. 点击附件图标选择多个文件\n` +
						`3. 每次上传自动生成 manifest.json 清单\n\n` +
						`上传完成后，可继续运行 Phase 1 审查。`,
				}],
				details: { tool: "zhicheng_upload_files", fileCount: files.length },
			};
		},
	});

	// Handle file uploads via input event — files sent with message text
	// Note: Files are handled via the upload tool and manual file copying.
	// The extension monitors the uploads/ directory for new files.
	pi.on("input", async (event) => {
		// If user sends files as images, process them
		if (event.images && event.images.length > 0) {
			const manifest = readManifest();
			const files: any[] = manifest.files || [];
			const now = new Date().toISOString();

			for (const img of event.images) {
				// Image content might have a path or base64 data
				if (img.image_url && typeof img.image_url === 'string') {
					// Skip base64 data URLs for now
					continue;
				}
			}
		}
	});

	// Phase 0: Download (from OSS CSV links) OR from local upload directory
	pi.registerTool({
		name: "zhicheng_phase0_download",
		label: "Phase 0: Download/Import Materials",
		description: "Download PDFs from OSS CSV links OR import files from local upload directory. "
			+ "If you have a CSV with OSS links: provide --csv. "
			+ "If files are already uploaded: use --upload-dir to import them. "
			+ "Uses scripts/download_from_oss.py.",
		promptSnippet: "From CSV: zhicheng_phase0_download --csv <path>\nFrom uploads: zhicheng_phase0_download --upload-dir uploads",
		promptGuidelines: [
			"Use --upload-dir when files are already uploaded via zhicheng_upload_files.",
			"Use --csv when you have a CSV with OSS signed links.",
			"Use --dry-run first to preview.",
		],
		parameters: Type.Object({
			csv: Type.String({ description: "Path to the申报清单 CSV with OSS signed links (optional, use with --upload-dir or without)", default: "" }),
			uploadDir: Type.String({ description: "Local directory with uploaded files (alternative to CSV)", default: "" }),
			out: Type.String({ description: "Output directory for downloaded PDFs (default: materials)", default: "materials" }),
			workers: Type.Number({ description: "Concurrent download threads (default: 8)", default: 8 }),
			retries: Type.Number({ description: "Retry count per file (default: 3)", default: 3 }),
			dryRun: Type.Boolean({ description: "Preview without downloading/importing", default: false }),
		}),
		async execute(_toolCallId, params) {
			const script = join(SCRIPTS_DIR, "download_from_oss.py");
			let cmdArgs: string[] = [];

			if (params.uploadDir) {
				// Local file import mode
				cmdArgs = ["--upload-dir", params.uploadDir, "--out", params.out, "--manifest", MANIFEST_FILE];
				if (params.dryRun) cmdArgs.push("--dry-run");
			} else if (params.csv) {
				// OSS download mode
				cmdArgs = [params.csv, "--out", params.out, "--workers", String(params.workers), "--retries", String(params.retries)];
				if (params.dryRun) cmdArgs.push("--dry-run");
			} else {
				return {
					content: [{
						type: "text",
						text: "Phase 0 requires either --csv (OSS links) or --upload-dir (local files). \\n" +
							"If you uploaded files via the UI, use: zhicheng_phase0_download --upload-dir uploads",
					}],
				};
			}

			writeProgress({ status: "downloading", current: 0, total: 0, details: "Starting download..." });
			startPolling();

			const result = await spawnPython(script, cmdArgs, 3600); // 1hr timeout for downloads
			stopPolling();

			const progress = readProgress();
			return {
				content: [{
					type: "text",
					text: `Phase 0 download complete.\n${result.stderr}\n${result.stdout}\nManifest: ${MANIFEST_FILE}\nStatus: ${progress.status || "unknown"}\n${result.ok ? "All OK" : "Some failures — check manifest.failed.csv"}`,
				}],
				details: { tool: "zhicheng_phase0_download", ok: result.ok, failed: (progress.failed as number) || 0 },
			};
		},
	});

	// Phase 1: Per-person review
	pi.registerTool({
		name: "zhicheng_phase1_review",
		label: "Phase 1: Per-Person Review",
		description: "Review one or all applicants against the 19-item checklist. "
			+ "Generates per-person review reports (reports/<person>_review.md) and issue lists.",
		promptSnippet: "Review all: zhicheng_phase1_review --persons all",
		promptGuidelines: [
			"Only run after Phase 0 completes (manifest.json must exist with uploaded files).",
			"Each conclusion cites source file + page.",
			"Items 5 (兼职) and 17 (指导) default to N/A.",
		],
		parameters: Type.Object({
			personId: Type.String({ description: "Single person ID to review (optional, conflicts with persons)" }),
			persons: Type.Array(Type.String(), { description: "List of person IDs to review, or ['all']" }),
			rules: Type.String({ description: "Path to zhicheng_rules.yaml (auto-detected from skill dir)", default: "" }),
		}),
		async execute(_toolCallId, params) {
			const script = join(SCRIPTS_DIR, "phase1_review.py");
			const cmdArgs: string[] = [MANIFEST_FILE];

			if (params.personId) {
				cmdArgs.push("--person-id", params.personId);
			} else if (params.persons) {
				cmdArgs.push("--persons", ...params.persons);
			} else {
				cmdArgs.push("--persons", "all");
			}

			if (params.rules) {
				cmdArgs.push("--rules", params.rules);
			}

			writeProgress({ status: "reviewing", current: 0, total: 0, details: "Starting review..." });
			startPolling();

			const result = await spawnPython(script, cmdArgs, 1800); // 30min timeout
			stopPolling();

			const progress = readProgress();
			return {
				content: [{
					type: "text",
					text: `Phase 1 review complete.\n${result.stderr}\n${result.stdout}\nReports: ${REPORTS_DIR}\nStatus: ${progress.status || "unknown"}`,
				}],
				details: { tool: "zhicheng_phase1_review", ok: result.ok, reviewed: (progress.current as number) || 0 },
			};
		},
	});

	// Phase 2: Generate aggregate ledger
	pi.registerTool({
		name: "zhicheng_phase2_ledger",
		label: "Phase 2: Generate Aggregate Ledger",
		description: "Read all per-person review reports and generate an aggregate ledger (ledger.csv). "
			+ "Covers: 缺件/超限/待核实/齐全 status per person.",
		promptSnippet: "Generate ledger: zhicheng_phase2_ledger",
		promptGuidelines: [
			"Only run after Phase 1 completes (reports/<person>_review.md must exist).",
			"Output: ledger.csv — filterable by status columns.",
		],
		parameters: Type.Object({
			reportsDir: Type.String({ description: "Path to reports/ directory (auto-detected)", default: "" }),
			out: Type.String({ description: "Output CSV path (default: ledger.csv)", default: "ledger.csv" }),
		}),
		async execute(_toolCallId, params) {
			const script = join(SCRIPTS_DIR, "phase2_ledger.py");
			const cmdArgs: string[] = ["--out", params.out];
			if (params.reportsDir) {
				cmdArgs.push("--reports-dir", params.reportsDir);
			} else {
				cmdArgs.push("--reports-dir", REPORTS_DIR);
			}

			const result = await spawnPython(script, cmdArgs, 120);

			return {
				content: [{
					type: "text",
					text: `Phase 2 ledger generation complete.\n${result.stderr}\n${result.stdout}\nLedger: ${params.out}`,
				}],
				details: { tool: "zhicheng_phase2_ledger", ok: result.ok },
			};
		},
	});

	// Status check tool
	pi.registerTool({
		name: "zhicheng_status",
		label: "Status: Check Pipeline Progress",
		description: "Check current status of the zhicheng-review pipeline (download/review/ledger).",
		promptSnippet: "Check status: zhicheng_status",
		parameters: Type.Object({}),
		async execute(_toolCallId) {
			const progress = readProgress();
			const manifestExists = existsSync(MANIFEST_FILE);
			const reportsDirExists = existsSync(REPORTS_DIR);
			let reportCount = 0;
			if (reportsDirExists) {
				try {
					reportCount = readdirSync(REPORTS_DIR).filter((f: string) => f.endsWith("_review.md")).length;
				} catch { /* ignore */ }
			}

			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						pipeline_status: progress.status || "idle",
						current: progress.current || 0,
						total: progress.total || 0,
						details: progress.details || "",
						manifest_exists: manifestExists,
						reports_count: reportCount,
						reports_dir: REPORTS_DIR,
						manifest_file: MANIFEST_FILE,
					}, null, 2),
				}],
				details: { tool: "zhicheng_status" },
			};
		},
	});

	// ── Register command ──────────────────────────────────────────────────

	pi.registerCommand("zhicheng-review", {
		description: "Run the 职称评审 batch review pipeline. Usage: /zhicheng-review [phase] [--csv path] [--person ID]",
		handler: async (args, ctx) => {
			const trimmed = args.trim();

			// Quick status check
			if (trimmed === "status") {
				const progress = readProgress();
				const reportsDirExists = existsSync(REPORTS_DIR);
				let reportCount = 0;
				if (reportsDirExists) {
					reportCount = readdirSync(REPORTS_DIR).filter((f: string) => f.endsWith("_review.md")).length;
				}
				const manifest = readManifest();
					const files = (manifest.files as any[]) || [];
					ctx.ui.notify(
						`Pipeline: ${progress.status || "idle"} | ${progress.current}/${progress.total} | Reports: ${reportCount} | Files: ${files.length}`,
						"info"
					);
				return;
			}

			// Stop polling and cleanup on shutdown
			ctx.ui.notify("To run pipeline, use the tools instead: /zhicheng-review help for options", "info");

			ctx.ui.setWidget("zhicheng-review", [
				"职称评审 pipeline",
				"Available tools:",
				"  zhicheng_phase0_download  — 下载附件",
				"  zhicheng_phase1_review    — 逐人审查",
				"  zhicheng_phase2_ledger    — 生成总台账",
				"  zhicheng_status           — 查看进度",
			]);
		},
	});

	// ── Cleanup on session end ────────────────────────────────────────────

	pi.on("session_shutdown", () => {
		stopPolling();
		if (activeTask) {
			try { activeTask.kill("SIGTERM"); } catch { /* ignore */ }
			activeTask = null;
		}
	});
}