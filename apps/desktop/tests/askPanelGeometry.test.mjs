import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

/**
 * AskPanel 胶囊位置钳制纯逻辑测试（src/renderer/src/utils/askPanelGeometry.ts）。
 * 该模块无依赖，直接 transpile + vm 运行，无需 stub。
 *
 * 注意：vm 沙箱创建的对象原型与测试 realm 不同，deepEqual/deepStrictEqual 会判
 * 引用不等；0.48*vh 还有二进制浮点尾差（如 0.48*500 = 240.00000000000003）——
 * 统一用字段级容差比较。
 */
function loadGeometry() {
	const source = readFileSync("src/renderer/src/utils/askPanelGeometry.ts", "utf8");
	const output = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
		fileName: "askPanelGeometry.ts",
	}).outputText;
	const module = { exports: {} };
	vm.runInNewContext(output, { module, exports: module.exports, console }, { filename: "askPanelGeometry.ts" });
	return module.exports;
}

const g = loadGeometry();
const VIEWPORT = { width: 1440, height: 900 };

function assertClose(actual, expected, label) {
	assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`);
}
function assertPos(actual, x, y) {
	assertClose(actual.x, x, "x");
	assertClose(actual.y, y, "y");
}

test("clamp keeps an in-viewport position unchanged", () => {
	assertPos(g.clampCapsulePosition(100, 200, VIEWPORT, false), 100, 200);
	// 展开时 x 下限 228、y 下限 416（面板悬于上方），300/500 在合法区间内原样保留
	assertPos(g.clampCapsulePosition(300, 500, VIEWPORT, true), 300, 500);
});

test("collapsed: clamps x into the right edge (pill width 340)", () => {
	// 右缘留白 8：x 上限 = 1440 - 8 - 340
	assertPos(g.clampCapsulePosition(1500, 200, VIEWPORT, false), 1092, 200);
});

test("collapsed: clamps x into the left edge", () => {
	// 折叠时面板不渲染，胶囊可贴到留白（x = 8）
	assertPos(g.clampCapsulePosition(-50, 200, VIEWPORT, false), 8, 200);
});

test("collapsed: clamps y into the bottom edge", () => {
	// 胶囊高 36，底缘留白 8：y 上限 = 900 - 8 - 36
	assertPos(g.clampCapsulePosition(100, 900, VIEWPORT, false), 100, 856);
});

test("expanded: y must leave room for the panel above the pill (panel 400px + gap 8 + margin 8)", () => {
	// 面板高 = min(400, 900*0.48=432) = 400 → y 下限 = 8 + 400 + 8
	assertPos(g.clampCapsulePosition(300, 50, VIEWPORT, true), 300, 416);
});

test("expanded: x must keep the panel left edge visible (panel 560 vs pill 340)", () => {
	// 面板左缘 = x + 340 - 560 ≥ 8 → x ≥ 228
	assertPos(g.clampCapsulePosition(10, 500, VIEWPORT, true), 228, 500);
});

test("expanded: x clamps into the right edge as well", () => {
	// 面板右缘 = x + 340 ≤ 1440-8 → x ≤ 1092（与折叠时一致）
	assertPos(g.clampCapsulePosition(1200, 500, VIEWPORT, true), 1092, 500);
});

test("expanded: y clamps into the bottom edge", () => {
	// x 取 300 避开左缘钳制（展开时 x 下限 228）
	assertPos(g.clampCapsulePosition(300, 900, VIEWPORT, true), 300, 856);
});

test("small window: ranges collapse to the margin without inverting", () => {
	// vw=300：胶囊与面板宽都 = min(340, 300-32) = 268，x 只剩 [8, 300-8-268=24]；
	// y=10 在 [8, 456] 内原样保留（折叠时无面板上方约束）
	const small = { width: 300, height: 500 };
	assertPos(g.clampCapsulePosition(200, 10, small, false), 24, 10);
	// 展开时 y 下限 = 8 + min(400, 240) + 8 = 256，上界 = 500-8-36 = 456，不反转
	assertPos(g.clampCapsulePosition(200, 10, small, true), 24, 256);
});

test("panel height scales with viewport height below the 400px cap", () => {
	// 48vh = 240 < 400 → 面板 240，y 下限 = 8 + 240 + 8
	const short = { width: 1440, height: 500 };
	// x 取 300（展开时 x 下限 228，不受左缘钳制干扰）
	assertPos(g.clampCapsulePosition(300, 10, short, true), 300, 256);
});
