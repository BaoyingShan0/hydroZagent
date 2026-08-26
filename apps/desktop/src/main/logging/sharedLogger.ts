import type { AppLogger } from "./AppLogger";

/**
 * AppLogger 共享实例注册表（无 electron 依赖）。
 *
 * 为什么单独一个文件：AppLogger.ts 顶层 import electron，而 trash.ts 等底层
 * 工具模块会被纯 Node 集成测试真实编译执行——若直接从 AppLogger.ts 导出
 * 访问器，electron 依赖会沿 import 图泄漏导致 MODULE_NOT_FOUND。
 * 这里只做 type-only import（编译期擦除），运行时零依赖。
 */
let sharedAppLogger: AppLogger | null = null;

/** 应用启动时注册共享实例（index.ts 创建后调用）；测试可注入替身。 */
export function setAppLogger(logger: AppLogger): void {
	sharedAppLogger = logger;
}

/** 取共享实例；未注册时返回 null，调用方自行静默跳过（启动早期/测试环境）。 */
export function getAppLogger(): AppLogger | null {
	return sharedAppLogger;
}
