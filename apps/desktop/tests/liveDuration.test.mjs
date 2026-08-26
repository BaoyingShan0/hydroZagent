import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

/** 编译 .ts 模块并在 vm 中加载（零外部依赖，node 直跑）。 */
function loadTsModule(filePath) {
  const output = ts.transpileModule(readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (id) => (id.includes("duration") ? { formatDuration: (ms) => `${ms}ms` } : {}),
  });
  return module.exports;
}

test("formatDuration: ms / seconds / minutes buckets", () => {
  const { formatDuration } = loadTsModule("src/renderer/src/components/session/TimelineFormat.ts");
  assert.equal(formatDuration(850), "850ms");
  assert.equal(formatDuration(3200), "3.2s");
  assert.equal(formatDuration(64000), "1m4s");
  assert.equal(formatDuration(120000), "2m");
});

test("LiveDuration: live tick only while streaming, fixed after end", () => {
  const source = readFileSync(
    "src/renderer/src/components/session/LiveDuration.tsx",
    "utf8",
  );
  // 100ms tick：仅 isStreaming 时启动 interval，结束/卸载清理
  assert.match(source, /setInterval\(\(\) => setNow\(Date\.now\(\)\), 100\)/);
  assert.match(source, /if \(!props\.isStreaming\) return;/);
  assert.match(source, /clearInterval\(timer\)/);
  // 结束截止：endedAt > 0 时用固定差值，不再依赖 now
  assert.match(source, /ended \?\? now\) - started/);
  // 无 startedAt 不渲染
  assert.match(source, /if \(started == null \|\| started <= 0\) return null;/);
});

test("three duration call sites reuse LiveDuration", () => {
  const turnRow = readFileSync("src/renderer/src/components/session/turn/TurnRow.tsx", "utf8");
  const toolCard = readFileSync("src/renderer/src/components/session/ToolCallComponents.tsx", "utf8");
  const thinking = readFileSync("src/renderer/src/components/session/TimelineEventCards.tsx", "utf8");
  // TurnRow run 耗时：流式中实时（agentRunning 驱动，不依赖 endedAt）、结束截止
  assert.match(turnRow, /<LiveDuration[\s\S]*?startedAt=\{run\.startedAt\}/);
  assert.match(turnRow, /isRunLive \?/);
  // ThinkingBlock 思考耗时（新架构在 TimelineEventCards.tsx）
  assert.match(thinking, /<LiveDuration[\s\S]*?startedAt=\{props\.startedAt\}/);
  // 思考流式中即带「思考了」前缀（结束时不蹦文案）
  assert.match(thinking, /thinking\.durationPrefix/);
  // ToolCard 工具耗时：running 时从消息时间戳实时计时
  assert.match(toolCard, /<LiveDuration[\s\S]*?startedAt=\{props\.message\.timestamp\}/);
});
