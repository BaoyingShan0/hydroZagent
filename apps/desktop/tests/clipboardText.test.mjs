/**
 * clipboard.ts 文本转换纯函数测试：
 * htmlToPlainText（富文本 → 纯文本：块级换行保留、标签剥除、实体还原、空行收敛）。
 * 采用项目惯例（同 composerPlainTextCodec.test.mjs）：transpileModule + vm 加载 TS 源码。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadClipboardUtils() {
	const source = readFileSync("src/renderer/src/utils/clipboard.ts", "utf8");
	const out = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
		fileName: "clipboard.ts",
	}).outputText;
	const module = { exports: {} };
	// clipboard.ts 顶层无 window/document 访问；提供空 window 兜底防未来改动
	vm.runInNewContext(
		out,
		{
			module,
			exports: module.exports,
			require: () => ({}),
			console,
			window: {},
		},
		{ filename: "clipboard.ts" },
	);
	return module.exports;
}

describe("htmlToPlainText", () => {
	const { htmlToPlainText } = loadClipboardUtils();

	test("converts block tags to newlines and strips inline tags", () => {
		assert.equal(htmlToPlainText("<p>first</p><p>second</p><div>third</div>"), "first\nsecond\nthird");
	});

	test("preserves list structure", () => {
		assert.equal(htmlToPlainText("<ul><li>a</li><li>b</li></ul>"), "a\nb");
	});

	test("handles <br> and headings", () => {
		assert.equal(htmlToPlainText("line1<br>line2<h2>title</h2>tail"), "line1\nline2\ntitle\ntail");
	});

	test("decodes common entities", () => {
		assert.equal(htmlToPlainText("a&nbsp;b &amp; c &lt;d&gt; &quot;e&quot; &#39;f&#39;"), "a b & c <d> \"e\" 'f'");
	});

	test("collapses excess blank lines and trims", () => {
		assert.equal(htmlToPlainText("<p>x</p>\n\n\n\n<p>y</p>\n"), "x\n\ny");
	});

	test("plain text without tags passes through", () => {
		assert.equal(htmlToPlainText("hello world"), "hello world");
	});
});
