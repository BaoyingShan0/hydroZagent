import { test, expect } from "./fixtures";

/**
 * 冒烟：应用能起窗、首帧渲染完成、工作台骨架在位。
 * 对应 #113 手测清单 3.1 的「冷启动到主界面」。
 */
test("app boots to the workbench shell", async ({ window }) => {
	// 启动遮罩最终应消失（不卡在白屏）
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	// 工作台骨架：左侧栏 + 会话区
	await expect(window.locator(".wechat-shell")).toBeVisible();
	await expect(window.locator(".chat-list-pane")).toBeVisible();
	await expect(window.locator(".chat-pane")).toBeVisible();
});
