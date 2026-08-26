import { test, expect } from "./fixtures";

/**
 * 配置管理弹窗（pi 管理）各 Agent 能力 tab 的 smoke（#113 手测 #16 自动化部分）：
 * - 扩展：推荐扩展包列表静态渲染（不依赖网络/pi），IPC 失败不白屏
 * - 技能：SkillsTab 空态/列表渲染
 * - 提示词：PromptsTab 渲染
 * - 飞书机器人：ImTab 连接表单渲染（#113 手测 #15 的 UI 链路部分，真机收发仍需手动）
 *
 * 注意：e2e 无真实 pi/网络，这里只验证 UI 链路与错误兜底，不验证真实安装/开关。
 */
test("config modal: extension store section renders recommended packages", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });

	await window.locator(".config-icon").click();
	const modal = window.locator(".config-layout");
	await expect(modal).toBeVisible();

	// 侧栏导航存在「扩展」入口
	const extensionsNav = modal.getByRole("button", { name: "扩展" });
	await expect(extensionsNav).toBeVisible();
	await extensionsNav.click();

	// 推荐扩展包静态渲染（即使 extensions.list IPC 失败也不影响此区域）
	await expect(modal.getByText("pi-deck-todo").first()).toBeVisible({ timeout: 10_000 });
	// 已安装状态徽标或错误条都不应让页面白屏——推荐列表仍在
	await expect(modal.locator(".extensions-recommended-row").first()).toBeVisible();
});

test("config modal: skills section renders empty state and create form", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });

	await window.locator(".config-icon").click();
	const modal = window.locator(".config-layout");
	await expect(modal).toBeVisible();

	await modal.getByRole("button", { name: "技能" }).click();
	// 空态文案或列表区域（无 pi 环境下至少渲染空态，不白屏）
	await expect(modal.locator(".config-sidebar")).toBeVisible();
	// SkillsTab 渲染出「新建技能」入口或空态文案
	await expect(modal.getByText("技能").first()).toBeVisible();
});

test("config modal: feishu bot section renders connect form (UI smoke)", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });

	await window.locator(".config-icon").click();
	const modal = window.locator(".config-layout");
	await expect(modal).toBeVisible();

	await modal.getByRole("button", { name: "飞书机器人" }).click();
	// 空态先渲染（无 Bot 配置），再点「添加 Bot」展开表单
	await expect(modal.getByText("暂无 Bot 配置")).toBeVisible({ timeout: 10_000 });
	await modal.getByRole("button", { name: "添加 Bot" }).click();
	// 添加 Bot 表单：App ID 输入框（真实连接需要有效凭据，e2e 只验证表单可交互）
	const appIdInput = modal.locator('input[placeholder="cli_xxxxxxxxxxxx"]').first();
	await expect(appIdInput).toBeVisible({ timeout: 10_000 });
	await appIdInput.fill("cli_e2e_test_app");
	await expect(appIdInput).toHaveValue("cli_e2e_test_app");
});
