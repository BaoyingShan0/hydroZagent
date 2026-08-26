/**
 * pideck-pet:// 协议纯函数（无 electron 依赖，可单测）。
 *
 * manifest 携带的 spritesheetUrl 是协议 URL（不是 base64 data URL），
 * <img>/Image 由 Chromium 按需请求 pideck-pet://，主进程 handler 读文件返回——
 * 避免每次打开设置/切换宠物都经 IPC 搬运 7.4MB+ 的雪碧图字符串。
 */
import { extname, resolve, sep } from "node:path";

/** manifest 用的协议 URL（协议 handler 按 petId 反查磁盘路径） */
export function petSpriteUrl(petId: string): string {
	return `pideck-pet://local/${encodeURIComponent(petId)}`;
}

/** 资源扩展名 → Content-Type */
export function spriteMimeOf(p: string): string {
	const ext = extname(p).toLowerCase();
	const map: Record<string, string> = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".gif": "image/gif" };
	return map[ext] ?? "application/octet-stream";
}

/** 解析 pideck-pet:// 请求 URL → petId；host/格式不合法返回 null（拒绝）。 */
export function parsePetSpriteUrl(rawUrl: string): string | null {
	try {
		const url = new URL(rawUrl);
		if (url.protocol !== "pideck-pet:" || url.host !== "local") return null;
		const petId = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
		// 只接受单段 id，防路径分隔符注入（resolveSpritePath 查白名单兜底）
		if (!petId || petId.includes("/") || petId.includes("\\")) return null;
		return petId;
	} catch {
		return null;
	}
}

/** 路径必须位于允许根目录内（resolve 后比较，防 ../ 逃逸）。 */
export function isSpritePathAllowed(filePath: string, roots: string[]): boolean {
	const resolved = resolve(filePath);
	return roots.some((root) => {
		const rootResolved = resolve(root);
		return resolved === rootResolved || resolved.startsWith(rootResolved + sep);
	});
}
