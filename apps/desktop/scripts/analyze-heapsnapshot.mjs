/**
 * analyze-heapsnapshot —— 解析 Chrome/Electron 导出的 .heapsnapshot（V8 堆快照），
 * 输出内存大头排名，重点标记 Detached DOM（泄漏最典型信号）与大字符串。
 *
 * 用法：node scripts/analyze-heapsnapshot.mjs <file.heapsnapshot> [--top N]
 *
 * 为什么自研而不开 DevTools：快照来自用户导出，脚本可批量/历史对比；
 * 且只需 self_size 聚合，不需要构建完整 retain 图，解析极快（60MB 快照 ~2s）。
 */

import { readFile } from "node:fs/promises";

const topN = Number(process.argv.find((a) => a.startsWith("--top="))?.split("=")[1] ?? 20);
const file = process.argv[2];
if (!file) {
	console.error("用法: node scripts/analyze-heapsnapshot.mjs <file.heapsnapshot> [--top=N]");
	process.exit(1);
}

const snap = JSON.parse(await readFile(file, "utf8"));
const meta = snap.snapshot.meta;
const nodeFields = meta.node_fields; // 新格式 7 字段
const nodeTypes = meta.node_types[0];
const nameIdx = nodeFields.indexOf("name");
const selfIdx = nodeFields.indexOf("self_size");
const detachIdx = nodeFields.indexOf("detachedness");
const stride = nodeFields.length;
const nodes = snap.nodes;
const strings = snap.strings;

const N = nodes.length / stride;
const typeSelf = new Map(); // "type:name" → { self, count }
const detached = []; // { name, self }
const bigStrings = []; // { name, self }
const domSelf = new Map(); // DOM 元素类型聚合
let totalSelf = 0;
let detachedTotal = 0;
let detachedCount = 0;

for (let i = 0; i < N; i++) {
	const base = i * stride;
	const typeIdx = nodes[base];
	const type = nodeTypes[typeIdx];
	const name = strings[nodes[base + nameIdx]];
	const self = nodes[base + selfIdx];
	const detachedness = detachIdx >= 0 ? nodes[base + detachIdx] : 0;
	totalSelf += self;

	if (detachedness > 0) {
		// Detached DOM：已从文档移除但仍被 JS 引用的节点，是 DOM 泄漏的铁证
		detachedTotal += self;
		detachedCount++;
		detached.push({ name, self });
		continue;
	}
	if (type === "string" && self > 256 * 1024) {
		// 大字符串：base64 图片 data URL、大 JSON 都会落在这里
		bigStrings.push({ name, self });
		continue;
	}
	const key = `${type}:${name}`;
	const cur = typeSelf.get(key);
	if (cur) {
		cur.self += self;
		cur.count++;
	} else {
		typeSelf.set(key, { self, count: 1 });
	}
	// DOM 元素节点单独聚合（HTML* 开头 + 元素类型）
	if (type === "object" && /^HTML/.test(name)) {
		const dom = domSelf.get(name);
		if (dom) {
			dom.self += self;
			dom.count++;
		} else {
			domSelf.set(name, { self, count: 1 });
		}
	}
}

const MB = 1024 * 1024;
const fmt = (kb) => (kb / MB).toFixed(1) + " MB";
const rank = (map, n) =>
	[...map.entries()]
		.sort((a, b) => b[1].self - a[1].self)
		.slice(0, n)
		.map(([k, v]) => `${fmt(v.self).padStart(9)}  ×${String(v.count).padStart(7)}  ${k}`);

console.log(`## ${file}`);
console.log(`- 节点总数：${N.toLocaleString()}，self_size 合计 ${fmt(totalSelf)}`);
console.log(`- Detached DOM：${detachedCount.toLocaleString()} 个节点，${fmt(detachedTotal)}（>0 即有泄漏嫌疑）`);
console.log("");
console.log("## Detached DOM 明细（按 self_size 降序 top 20）");
for (const d of [...detached].sort((a, b) => b.self - a.self).slice(0, 20)) {
	console.log(`  ${fmt(d.self).padStart(9)}  ${d.name}`);
}
console.log("");
console.log(`## 大字符串 top ${Math.min(topN, bigStrings.length)}（>256KB，base64 图片会在这里现形）`);
for (const s of [...bigStrings].sort((a, b) => b.self - a.self).slice(0, topN)) {
	const preview = s.name.length > 70 ? s.name.slice(0, 70) + "…" : s.name;
	console.log(`  ${fmt(s.self).padStart(9)}  ${preview}`);
}
console.log("");
console.log(`## self_size 聚合 top ${topN}（type:name）`);
console.log(rank(typeSelf, topN).join("\n"));
console.log("");
console.log(`## DOM 元素节点（HTML*，含挂载中的）top 15`);
console.log(rank(domSelf, 15).join("\n"));
