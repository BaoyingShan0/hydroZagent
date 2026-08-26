/**
 * pideck-pet:// 协议 handler：按 petId 服务宠物雪碧图文件。
 *
 * 安全：petId 白名单来自扫描结果（resolveSpritePath），且 handler 对最终路径
 * 再做一次 resolve 根校验（防 pet.json 的 ../ 逃逸与未来扫描逻辑回归）。
 * scheme 特权声明（registerSchemesAsPrivileged）必须在 app ready 前完成。
 */

import { protocol, session } from "electron";
import { readFile } from "node:fs/promises";
import { isSpritePathAllowed, parsePetSpriteUrl, spriteMimeOf } from "./petSpriteUrl.ts";

/** 宠物悬浮窗独立 partition：协议必须同时挂到这个 session，不能只挂 defaultSession。 */
export const PET_WINDOW_PARTITION = "persist:pet";

export type PetSpriteProtocolDeps = {
	/** petId → 磁盘绝对路径（扫描白名单）；未知 id 返回 null */
	resolveSpritePath: (petId: string) => Promise<string | null>;
	/** 允许读取的根目录（内置资源目录 + petdex 根） */
	roots: string[];
};

function handlePetSpriteRequest(deps: PetSpriteProtocolDeps) {
	return async (request: Request): Promise<Response> => {
		const petId = parsePetSpriteUrl(request.url);
		if (!petId) {
			return new Response("forbidden", { status: 403 });
		}
		const spritePath = await deps.resolveSpritePath(petId);
		if (!spritePath) {
			return new Response("not found", { status: 404 });
		}
		if (!isSpritePathAllowed(spritePath, deps.roots)) {
			return new Response("forbidden", { status: 403 });
		}
		try {
			const data = await readFile(spritePath);
			return new Response(data, { headers: { "Content-Type": spriteMimeOf(spritePath) } });
		} catch {
			return new Response("not found", { status: 404 });
		}
	};
}

/**
 * 注册 pideck-pet:// 协议 handler（app ready 后调用）。
 * 主窗口设置预览走 defaultSession；桌面宠物窗走 persist:pet。
 * 只挂一侧时，另一侧 Image.decode 失败，PetOverlay 会落到 emoji 兜底。
 */
export function registerPetSpriteProtocol(deps: PetSpriteProtocolDeps): void {
	const handler = handlePetSpriteRequest(deps);
	protocol.handle("pideck-pet", handler);
	session.fromPartition(PET_WINDOW_PARTITION).protocol.handle("pideck-pet", handler);
}
