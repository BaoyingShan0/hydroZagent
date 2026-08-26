import { getAppLogger } from "../logging/sharedLogger";

/**
 * 将文件/目录移入系统回收站（可恢复删除）。
 *
 * 统一入口：所有「用户主动删除」都必须走这里，禁止直接 rm/unlink 硬删
 * （历史教训：worktree 误删曾导致整目录永久丢失）。
 * 回收站不可用/被禁用时直接抛错——删除失败比永久丢失安全，
 * 调用方（IPC handler / 服务层）负责把错误呈现给用户。
 *
 * electron 采用懒加载：GitService 等模块会被纯 Node 集成测试真实编译执行，
 * 顶层 import "electron" 会直接 MODULE_NOT_FOUND；延迟到调用时才 require，
 * 只有真正执行删除路径才需要 electron 环境。
 */
let shellRef: typeof import("electron").shell | undefined;

async function getShell(): Promise<typeof import("electron").shell> {
	if (!shellRef) {
		shellRef = (await import("electron")).shell;
	}
	return shellRef;
}

/**
 * 删除来源上下文：记录「谁发起的删除」，审计时可回溯到具体 UI 操作。
 * source 取值示例："git:discard" / "git:delete-files" / "extension:uninstall" / "projects:remove"。
 */
export type TrashContext = {
	source: string;
	/** 删除目标数（批量删除时 > 1） */
	count?: number;
};

/**
 * 审计日志：每次删除必记一条 warn 日志（路径 + 来源），
 * 排查误删（如回收站被清空后无法恢复）时可按路径/来源检索。
 * 失败同样记录 error 日志，带原始错误。
 */
export async function trashPath(targetPath: string, context: TrashContext): Promise<void> {
	const shell = await getShell();
	try {
		await shell.trashItem(targetPath);
		getAppLogger()?.warn("fs:trash", "文件移入回收站", {
			path: targetPath,
			source: context.source,
			count: context.count ?? 1,
		});
	} catch (error) {
		getAppLogger()?.error("fs:trash", "移入回收站失败", {
			path: targetPath,
			source: context.source,
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}
