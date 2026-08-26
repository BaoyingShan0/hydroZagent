import { test, expect } from "./mock-pi-fixture";
import type { Page } from "@playwright/test";

/**
 * 点击欢迎页「启动 Agent」并等待其生效。
 * 启动初期界面存在重渲染竞态（偶发 click 落在被替换的 DOM 节点上丢失），
 * 用户也会双击，这里以「按钮消失 / 会话视图出现」为生效信号做有限重试。
 */
async function startAgent(window: Page) {
	const startButton = window.getByRole("button", { name: "启动 Agent" });
	const composer = window.locator(".composer .rich-input");
	for (let attempt = 0; attempt < 4; attempt += 1) {
		await startButton.click();
		// agent 启动后欢迎页按钮消失；同时等待 composer 可用
		const gone = await startButton
			.waitFor({ state: "hidden", timeout: 5000 })
			.then(() => true)
			.catch(() => false);
		if (gone) break;
	}
	await expect(composer).toHaveAttribute("contenteditable", "true", { timeout: 30_000 });
	return composer;
}

/**
 * 会话路径完整流程（#113 3.2-5/6、#115 U6）：
 * 新建会话 → 发送消息 → 流式渲染 → 完成 → 再发 → 中途停止。
 * 全程走真实 spawn + stdio JSON-RPC（mock pi），不依赖网络与真实 pi。
 */
test("agent flow: prompt -> streaming -> done -> prompt -> abort", async ({ window }) => {
	test.setTimeout(120_000);
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });

	// 1. 内置聊天项目欢迎页：启动 Agent（spawn mock pi）
	const composer = await startAgent(window);

	// 3. 发送第一条消息：流式渲染 → 完整回复
	await composer.click();
	await window.keyboard.type("你好 mock");
	await window.keyboard.press("Enter");

	const timeline = window.locator(".message-timeline");
	// 流式中间态：完整标记未出现前，部分内容应已可见
	await expect(timeline).toContainText("Mock 回复：「你好 mock」", { timeout: 15_000 });
	// 完整收尾
	await expect(timeline).toContainText("流式渲染验证完成", { timeout: 15_000 });

	// 4. 第二条消息（慢速流），中途点击「停止」
	await composer.click();
	await window.keyboard.type("SLOW 第二段");
	await window.keyboard.press("Enter");

	const stopButton = window.getByRole("button", { name: "停止" });
	await expect(stopButton).toBeVisible({ timeout: 10_000 });
	// 等到第二段开始流式输出再停止，覆盖"流式中中止"路径
	await expect(timeline).toContainText("Mock 回复：「SLOW 第二段」", { timeout: 10_000 });
	await stopButton.click();

	// 5. 停止后回到空闲：发送按钮回归；第二段不应出现完整收尾标记
	const sendButton = window.locator(".composer-bar-btn.send");
	await expect(sendButton).toBeVisible({ timeout: 10_000 });
	await window.waitForTimeout(1500); // 给残留流 1.5s 窗口，验证封印生效
	await expect(timeline).not.toContainText("SLOW 第二段」流式渲染验证完成");
});

/**
 * 排队消息（#113 3.2-10）：agent 流式输出中再发一条，应进入本地排队；
 * 当前 run 结束后按顺序继续回答第二条（默认忙碌行为 steer，桌面端冲刷后
 * 由 mock 串行开新 run，语义与 followUp 一致：先答的先出、后答的接上）。
 */
test("agent flow: queued prompt while busy drains in order", async ({ window }) => {
	test.setTimeout(120_000);
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	const composer = await startAgent(window);
	const timeline = window.locator(".message-timeline");

	// 慢速流期间发送第二条
	await composer.click();
	await window.keyboard.type("SLOW 排队一");
	await window.keyboard.press("Enter");
	await expect(timeline).toContainText("Mock 回复：「SLOW 排队一」", { timeout: 10_000 });

	await composer.click();
	await window.keyboard.type("排队二");
	await window.keyboard.press("Enter");

	// 第一段完整收尾后，第二段按顺序回答
	await expect(timeline).toContainText("SLOW 排队一」流式渲染验证完成", { timeout: 20_000 });
	await expect(timeline).toContainText("Mock 回复：「排队二」流式渲染验证完成", { timeout: 20_000 });
});

/**
 * 模型选择 + thinking 级别切换（#113 3.4-13）：
 * 走真实 set_model/set_thinking_level RPC → mock 更新状态 → get_state 回读 →
 * composer 按钮标签刷新。验证「选择 → 生效 → UI 同步」闭环。
 */
test("agent flow: model picker and thinking level switch apply", async ({ window }) => {
	test.setTimeout(120_000);
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	const composer = await startAgent(window);
	const timeline = window.locator(".message-timeline");

	// 「启动 Agent」只创建草稿；真实 pi 进程在首次发送时 spawn。
	// 首轮 run 结束后 main 会 emitRuntimeState（含 modelName/thinkingLevel），
	// composer 按钮标签据此刷新。
	await composer.click();
	await window.keyboard.type("热身");
	await window.keyboard.press("Enter");
	await expect(timeline).toContainText("Mock 回复：「热身」流式渲染验证完成", { timeout: 20_000 });

	// 初始模型来自 get_state
	const modelButton = window.locator(".composer-bar-btn.model");
	await expect(modelButton).toContainText("Mock Model", { timeout: 10_000 });

	// 打开模型选择器，切到 Mock Model Pro
	await modelButton.click();
	const modelPalette = window.locator("[data-slot='dialog-content'].model-picker");
	await expect(modelPalette).toBeVisible({ timeout: 5000 });
	await modelPalette.locator("[data-slot='command-item']", { hasText: "mock-model-pro" }).click();
	await expect(modelButton).toContainText("Mock Model Pro", { timeout: 10_000 });

	// thinking 级别切换：初始值取决于会话配置（可能来自 ~/.pi/agent/settings.json），
	// 不断言具体档位，切到 low 后验证生效
	const thinkingButton = window.locator(".composer-bar-btn.thinking");
	await thinkingButton.click();
	const thinkingPalette = window.locator("[data-slot='dialog-content'].thinking-picker");
	await expect(thinkingPalette).toBeVisible({ timeout: 5000 });
	await thinkingPalette.locator("[data-slot='command-item']", { hasText: "low" }).first().click();
	await expect(thinkingButton).toContainText("low", { timeout: 10_000 });
});

/**
 * compact（#113 3.2-7）：上下文占比 >30% 显示压缩 chip；点击后走真实
 * compact RPC + compaction_start/end 事件序列；完成后占比降至 12%，
 * chip 应消失、agent 回到空闲（发送按钮回归）。
 */
test("agent flow: compact chip compacts and disappears", async ({ window }) => {
	test.setTimeout(120_000);
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	const composer = await startAgent(window);
	const timeline = window.locator(".message-timeline");

	// 首轮 run 结束后 emitRuntimeState 带上 contextUsage.percent=45 → chip 出现
	await composer.click();
	await window.keyboard.type("压缩前消息");
	await window.keyboard.press("Enter");
	await expect(timeline).toContainText("Mock 回复：「压缩前消息」流式渲染验证完成", { timeout: 20_000 });

	const compactChip = window.locator(".composer-bar-btn.compact");
	await expect(compactChip).toBeVisible({ timeout: 10_000 });
	await compactChip.click();

	// 压缩完成：占比降至 12%（≤30%），chip 隐藏；agent 回到空闲可继续发送
	await expect(compactChip).toBeHidden({ timeout: 15_000 });
	await expect(window.locator(".composer-bar-btn.send")).toBeVisible({ timeout: 10_000 });

	// 压缩后会话仍可继续
	await composer.click();
	await window.keyboard.type("压缩后继续");
	await window.keyboard.press("Enter");
	await expect(timeline).toContainText("Mock 回复：「压缩后继续」流式渲染验证完成", { timeout: 20_000 });
});

/**
 * compact nothing-to-do（#113 3.2-7）：/compact NOTHING 触发 mock success:false，
 * 渲染层映射 app.compactNothingToDo 友好 toast，而不是吓人的通用失败。
 */
test("agent flow: compact nothing-to-do shows friendly notice", async ({ window }) => {
	test.setTimeout(120_000);
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	const composer = await startAgent(window);
	const timeline = window.locator(".message-timeline");

	await composer.click();
	await window.keyboard.type("nothing 预热");
	await window.keyboard.press("Enter");
	await expect(timeline).toContainText("Mock 回复：「nothing 预热」流式渲染验证完成", { timeout: 20_000 });

	// /compact 路径：prompt 带 NOTHING → mock respondFail("nothing to compact")
	await composer.click();
	await window.keyboard.type("/compact NOTHING");
	await window.keyboard.press("Enter");
	await expect(window.getByText("上下文还很小，暂无可压缩内容")).toBeVisible({ timeout: 10_000 });
});

/**
 * 排队可撤回（#113 3.2-10）：慢速流中再发一条进入排队条，点「丢弃」后条消失，
 * 且后续时间线不应出现被丢弃消息的回复。
 */
test("agent flow: queued prompt can be discarded", async ({ window }) => {
	test.setTimeout(120_000);
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	const composer = await startAgent(window);
	const timeline = window.locator(".message-timeline");

	await composer.click();
	await window.keyboard.type("SLOW 撤回底");
	await window.keyboard.press("Enter");
	await expect(timeline).toContainText("Mock 回复：「SLOW 撤回底」", { timeout: 10_000 });

	// 第二段入队
	await composer.click();
	await window.keyboard.type("待丢弃消息");
	await window.keyboard.press("Enter");

	const queuedTrack = window.locator(".queued-track");
	await expect(queuedTrack).toBeVisible({ timeout: 10_000 });
	await expect(queuedTrack).toContainText("待丢弃消息");

	// 丢弃（pending 状态可 discard）
	await queuedTrack.getByRole("button", { name: "丢弃" }).click();
	await expect(queuedTrack).toBeHidden({ timeout: 5000 });

	// 第一段结束后，被丢弃的消息不应再被回答
	await expect(timeline).toContainText("SLOW 撤回底」流式渲染验证完成", { timeout: 20_000 });
	await expect(timeline).not.toContainText("Mock 回复：「待丢弃消息」");
});

/**
 * fork（#113 3.2-8）：从用户消息 fork 新会话。
 * 走 get_fork_messages（entryId 回退匹配）→ fork RPC → 会话替换刷新，
 * 原文预填回输入框并出成功 toast。
 */
test("agent flow: fork from user message prefills composer", async ({ window }) => {
	test.setTimeout(120_000);
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	const composer = await startAgent(window);
	const timeline = window.locator(".message-timeline");

	await composer.click();
	await window.keyboard.type("fork 源句");
	await window.keyboard.press("Enter");
	await expect(timeline).toContainText("Mock 回复：「fork 源句」流式渲染验证完成", { timeout: 20_000 });

	// 悬停用户气泡出现 Fork 操作（忙碌中不显示，此处已空闲）
	const userBubble = timeline.locator("article.user-turn", { hasText: "fork 源句" }).first();
	await userBubble.hover();
	const forkBtn = userBubble.getByRole("button", { name: "Fork" });
	await expect(forkBtn).toBeVisible({ timeout: 5000 });
	await forkBtn.click();

	// 成功信号：composer 预填 或 成功 toast（sonner 竞态下二选一）
	await expect
		.poll(async () => {
			const draft = (await composer.innerText().catch(() => "")).trim();
			if (draft.includes("fork 源句")) return true;
			return window.getByText("已 fork 为新会话，原文已放入输入框").isVisible().catch(() => false);
		}, { timeout: 15_000 })
		.toBe(true);
});

/**
 * 重启 Agent → 会话可继续（#113 3.2-6）：
 * 会话头部 combo 菜单 → 重启；mock 按 cwd 稳定 sessionFile，重启后
 * 同一文件被重新接管，续发消息正常流式回答。
 */
test("agent flow: restart agent keeps session usable", async ({ window }) => {
	test.setTimeout(120_000);
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	const composer = await startAgent(window);
	const timeline = window.locator(".message-timeline");

	await composer.click();
	await window.keyboard.type("重启前");
	await window.keyboard.press("Enter");
	await expect(timeline).toContainText("Mock 回复：「重启前」流式渲染验证完成", { timeout: 20_000 });

	// 当前会话 Tab 的下拉按钮 → 重启（运行控制已从会话头部 combo 迁入 Tab 下拉）
	await window.locator('.session-tab[aria-selected="true"] [role="tab-menu"]').click();
	await window.getByRole("menuitem", { name: "重启", exact: true }).click();

	// 等重启真正完成：完成 toast 是唯一可靠的完成信号；
	// 过早发送会撞上 replacement reservation，被 coordinator 拒发（delivery:rejected）。
	await expect(window.getByText("Agent 已重启")).toBeVisible({ timeout: 30_000 });
	// composer 可用信号：TipTap 可用时不渲染 aria-disabled（只在 disabled 时输出
	// aria-disabled="true"），可编辑状态用 contenteditable="true" 表示
	await expect(composer).toHaveAttribute("contenteditable", "true", { timeout: 30_000 });
	await expect(window.locator(".composer-bar-btn.send")).toBeVisible({ timeout: 30_000 });

	// 续聊正常
	await composer.click();
	await window.keyboard.type("重启后");
	await window.keyboard.press("Enter");
	await expect(timeline).toContainText("Mock 回复：「重启后」流式渲染验证完成", { timeout: 20_000 });
});
