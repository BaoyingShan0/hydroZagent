import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

/** 用 vm 加载 PetStateBridge.ts（transpile 后仅依赖 shared/ipc 常量，mock require 即可） */
function loadBridge(timers = { setTimeout, clearTimeout }) {
	const source = readFileSync("src/main/pet/PetStateBridge.ts", "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	});
	const module = { exports: {} };
	const sandbox = {
		module,
		exports: module.exports,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
		Date,
		require: (id) => {
			if (id.endsWith("shared/ipc")) {
				return { ipcChannels: { petState: "pet:state", petNotify: "pet:notify" } };
			}
			throw new Error(`unexpected require: ${id}`);
		},
	};
	vm.runInNewContext(outputText, sandbox, { filename: "PetStateBridge.ts" });
	return module.exports;
}

/** 可控 fake timers：过渡动画测试无需真实等待 */
function createFakeTimers() {
	let nextId = 1;
	let now = 0;
	const tasks = new Map();
	return {
		timers: {
			setTimeout: (fn, ms) => {
				const id = nextId++;
				tasks.set(id, { fn, at: now + ms });
				return id;
			},
			clearTimeout: (id) => { tasks.delete(id); },
		},
		async advance(ms) {
			now += ms;
			const due = [...tasks.entries()]
				.filter(([, t]) => t.at <= now)
				.sort((a, b) => a[1].at - b[1].at);
			for (const [id] of due) tasks.delete(id);
			for (const [, t] of due) t.fn();
		},
	};
}

const { PetStateBridge } = loadBridge();

function createHarness(timers) {
	const { PetStateBridge: Bridge } = timers ? loadBridge(timers.timers) : { PetStateBridge };
	const states = [];
	const notifs = [];
	const win = {
		isDestroyed: () => false,
		setIgnoreMouseEvents: () => {},
		webContents: {
			send: (channel, payload) => {
				if (channel === "pet:state") states.push(payload);
				if (channel === "pet:notify") notifs.push(payload);
			},
		},
	};
	const patrol = { start: () => {}, stop: () => {}, active: false, setDragging: () => {} };
	const bridge = new Bridge(
		() => win,
		patrol,
		() => true,
		(key, params = {}) => {
			const map = {
				"pet.doneNotification": "{title} completed",
				"pet.agentError": "{title} encountered a problem",
				"pet.waitingNotification": "{title} needs your input",
				"pet.doneSuffix": "completed",
				"pet.errorSuffix": "encountered a problem",
				"pet.waitingSuffix": "needs your input",
			};
			return map[key].replace(/\{([A-Za-z0-9_]+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
		},
		(n) => notifs.push(n),
	);
	return { bridge, states, notifs, patrol };
}

function tab(overrides = {}) {
	return {
		id: "agent-1",
		projectId: "p1",
		cwd: "/tmp/p1",
		title: "会话一",
		status: "idle",
		createdAt: 1,
		...overrides,
	};
}

/** 等待 debounce（150ms）落地聚合状态 */
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));
test("baseline snapshot does not notify for pre-existing errors", () => {
	const { bridge, notifs } = createHarness();
	bridge.pushNow([tab({ status: "error" })]);
	assert.equal(notifs.length, 0);
});

test("first error edge emits an error notification with the agent title", () => {
	const { bridge, notifs } = createHarness();
	bridge.pushNow([tab({ status: "running" })]);
	bridge.pushNow([tab({ status: "error" })]);
	const errorNotif = notifs.find((n) => n && n.type === "error");
	assert.ok(errorNotif);
	assert.equal(errorNotif.text, "会话一 encountered a problem");
	assert.equal(errorNotif.agentId, "agent-1");
	// 重复 error 快照不再通知
	const count = notifs.filter((n) => n && n.type === "error").length;
	bridge.pushNow([tab({ status: "error" })]);
	assert.equal(notifs.filter((n) => n && n.type === "error").length, count);
});

test("select request enters waiting mode with persistent notification", async () => {
	const { bridge, states, notifs } = createHarness();
	bridge.pushNow([tab({ status: "running" })]);
	bridge.updateUIRequest({ agentId: "agent-1", requestId: "req-1", method: "select", title: "选哪个？" });
	assert.equal(states.at(-1).mode, "waiting");
	const waiting = notifs.at(-1);
	assert.equal(waiting.type, "waiting");
	assert.equal(waiting.persistent, true);
	assert.equal(waiting.text, "会话一 needs your input");
});

test("completing the request clears waiting and restores running", async () => {
	const { bridge, states, notifs } = createHarness();
	bridge.pushNow([tab({ status: "running" })]);
	bridge.updateUIRequest({ agentId: "agent-1", requestId: "req-1", method: "input", title: "q" });
	bridge.updateUIRequest({ agentId: "agent-1", requestId: "req-1", method: "input", completed: true });
	assert.equal(states.at(-1).mode, "running");
	assert.equal(notifs.at(-1), null);
});

test("multiple pending requests leave waiting until the last one completes", () => {
	const { bridge, states, notifs } = createHarness();
	bridge.pushNow([tab({ status: "running" })]);
	bridge.updateUIRequest({ agentId: "agent-1", requestId: "req-1", method: "select", title: "q1" });
	bridge.updateUIRequest({ agentId: "agent-1", requestId: "req-2", method: "confirm", title: "q2" });
	bridge.updateUIRequest({ agentId: "agent-1", requestId: "req-1", method: "select", completed: true });
	assert.equal(states.at(-1).mode, "waiting");
	bridge.updateUIRequest({ agentId: "agent-1", requestId: "req-2", method: "confirm", completed: true });
	assert.equal(states.at(-1).mode, "running");
	assert.equal(notifs.at(-1), null);
});

test("non-blocking UI methods do not enter waiting", () => {
	const { bridge, states, notifs } = createHarness();
	bridge.pushNow([tab({ status: "running" })]);
	bridge.updateUIRequest({ agentId: "agent-1", requestId: "w-1", method: "setWidget", widgetKey: "k" });
	bridge.updateUIRequest({ agentId: "agent-1", requestId: "n-1", method: "notify", notifyType: "info" });
	assert.equal(states.at(-1).mode, "running");
	assert.equal(notifs.filter((n) => n && n.type === "waiting").length, 0);
});

test("settled agent emits done notification with its title", () => {
	const { bridge, notifs } = createHarness();
	bridge.pushNow([tab({ status: "running" })]);
	bridge.onAgentSettled({ agentId: "agent-1", title: "会话一" });
	const done = notifs.at(-1);
	assert.equal(done.type, "done");
	assert.equal(done.text, "会话一 completed");
	assert.equal(done.agentId, "agent-1");
});

test("settled is suppressed while a request is pending or an error exists", () => {
	const { bridge, notifs } = createHarness();
	bridge.pushNow([tab({ status: "running" })]);
	bridge.updateUIRequest({ agentId: "agent-1", requestId: "req-1", method: "select", title: "q" });
	bridge.onAgentSettled({ agentId: "agent-1", title: "会话一" });
	assert.equal(notifs.at(-1).type, "waiting");

	const { bridge: b2, notifs: n2 } = createHarness();
	b2.pushNow([tab({ status: "running" })]);
	b2.pushNow([tab({ status: "error" })]);
	b2.onAgentSettled({ agentId: "agent-1", title: "会话一" });
	assert.equal(n2.at(-1).type, "error");
});

test("done notification is rate-limited per agent", () => {
	const { bridge, notifs } = createHarness();
	bridge.pushNow([tab({ status: "running" })]);
	bridge.onAgentSettled({ agentId: "agent-1", title: "会话一" });
	bridge.onAgentSettled({ agentId: "agent-1", title: "会话一" });
	assert.equal(notifs.filter((n) => n && n.type === "done").length, 1);
});

test("error takes priority over waiting, waiting over running", () => {
	const { bridge, states } = createHarness();
	bridge.pushNow([tab({ id: "a", title: "A", status: "running", createdAt: 1 })]);
	bridge.updateUIRequest({ agentId: "a", requestId: "r1", method: "select", title: "q" });
	assert.equal(states.at(-1).mode, "waiting");
	bridge.pushNow([
		tab({ id: "a", title: "A", status: "running", createdAt: 1 }),
		tab({ id: "b", title: "B", status: "error", createdAt: 2 }),
	]);
	assert.equal(states.at(-1).mode, "failed");
});

test("closing an agent clears its pending requests and dismisses waiting", () => {
	const { bridge, states, notifs } = createHarness();
	bridge.pushNow([tab({ status: "running" })]);
	bridge.updateUIRequest({ agentId: "agent-1", requestId: "req-1", method: "input", title: "q" });
	assert.equal(states.at(-1).mode, "waiting");
	// Agent 关闭（不再出现在快照中）
	bridge.pushNow([tab({ id: "agent-1", status: "closed", createdAt: 1 })]);
	// closed 被过滤后 active 为空 → idle；残留 pending 被清理并收起 waiting
	assert.equal(states.at(-1).mode, "idle");
	assert.equal(notifs.at(-1), null);
});

test("review animation still runs on aggregate running->idle without notifying", async () => {
	const fake = createFakeTimers();
	const { bridge, states, notifs } = createHarness(fake);
	bridge.pushNow([tab({ status: "running" })]);
	bridge.pushNow([tab({ status: "idle" })]);
	// review 过渡来自聚合边沿（动画），通知来自 settled 事件（本测试未触发）
	assert.equal(states.at(-1).mode, "review");
	assert.equal(notifs.filter((n) => n && n.type === "done").length, 0);
	await fake.advance(4000);
	assert.equal(states.at(-1).mode, "idle");
});
