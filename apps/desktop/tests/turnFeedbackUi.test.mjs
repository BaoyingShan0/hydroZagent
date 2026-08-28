import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = "src/renderer/src/components/session/turn/TurnFeedback.tsx";

test("turn feedback renders five accessible stars and a compact inline comment box", async () => {
	const source = await readFile(componentPath, "utf8");
	assert.match(source, /const STAR_VALUES = \[1, 2, 3, 4, 5\] as const/);
	assert.match(source, /role="radiogroup"/);
	assert.match(source, /role="radio"/);
	assert.match(source, /aria-checked=\{rating === value\}/);
	assert.match(source, /rating === value \? 0 : value/);
	assert.match(source, /SESSION_TURN_FEEDBACK_COMMENT_MAX_LENGTH/);
	assert.match(source, /<Input/);
	assert.match(source, /className="ml-2 flex min-w-0 flex-1 items-center/);
});

test("turn feedback persists immediately, after text debounce, on blur, and on unmount", async () => {
	const source = await readFile(componentPath, "utf8");
	assert.match(source, /mountedRef\.current = true/);
	assert.match(source, /void persistFeedback\(draftRef\.current\)/);
	assert.match(source, /COMMENT_SAVE_DELAY_MS/);
	assert.match(source, /onBlur=\{\(\) => \{/);
	assert.match(source, /时间线窗口裁剪可能在防抖到期前卸载旧轮/);
	assert.match(source, /window\.piDesktop\.sessions\.updateRecord/);
});

test("turn feedback copy exists in both renderer locales", async () => {
	const [zh, en] = await Promise.all([
		readFile("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8"),
		readFile("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8"),
	]);
	for (const key of [
		"turnFeedback.title",
		"turnFeedback.ratingLabel",
		"turnFeedback.placeholder",
		"turnFeedback.saveFailed",
	]) {
		assert.ok(zh.includes(`"${key}"`), `missing zh-CN key: ${key}`);
		assert.ok(en.includes(`"${key}"`), `missing en-US key: ${key}`);
	}
});
