/**
 * WSL 可执行文件路径解析模块。
 * Phase 2.2: 从 index.ts 中提取。智能查找 wsl.exe：
 * 优先绝对路径（含 32-bit Sysnative 绕过），全部不存在时回退到 PATH。
 */

import { join } from "node:path";
import { existsSync } from "node:fs";

let resolved: { command: string; shell: boolean } | null = null;

export function getWslExe(): { command: string; shell: boolean } {
	if (resolved) return resolved;
	const root = process.env.SystemRoot || "C:\\Windows";
	const candidates = process.arch === "ia32"
		? [join(root, "Sysnative", "wsl.exe"), join(root, "System32", "wsl.exe")]
		: [join(root, "System32", "wsl.exe")];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			resolved = { command: candidate, shell: false };
			return resolved;
		}
	}
	resolved = { command: "wsl", shell: true };
	return resolved;
}
