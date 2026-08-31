import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { runAgentLoopWithOutcome } from "../../src/agent-loop.ts";
import { ConvergenceController } from "../../src/convergence/index.ts";
import type { ToolOutcomeObservation } from "../../src/convergence/types.ts";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool, StreamFn } from "../../src/types.ts";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor(message: AssistantMessage) {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
		queueMicrotask(() => this.push({ type: "done", reason: message.stopReason, message }));
	}
}

function createModel(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

function assistantToolMessage(names: string[]): AssistantMessage {
	return {
		role: "assistant",
		content: names.map((name, index) => ({
			type: "toolCall" as const,
			id: `call-${index + 1}`,
			name,
			arguments: { value: name },
		})),
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 1,
	};
}

function assistantDoneMessage(): AssistantMessage {
	return { ...assistantToolMessage([]), content: [{ type: "text", text: "done" }], stopReason: "stop" };
}

function userMessage(): AgentMessage {
	return { role: "user", content: [{ type: "text", text: "go" }], timestamp: 0 };
}

function convertToLlm(messages: AgentMessage[]): Message[] {
	return messages.filter(
		(message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult",
	);
}

function createTool(name: string, execute: AgentTool["execute"]): AgentTool {
	return {
		name,
		label: name,
		description: name,
		parameters: Type.Object({ value: Type.String() }),
		execute,
	};
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function successResult(value: string) {
	return { content: [{ type: "text" as const, text: value }], details: { value } };
}

async function runToolBatch(
	tools: AgentTool[],
	configOverrides: Partial<AgentLoopConfig>,
	events: AgentEvent[],
	onEvent?: (event: AgentEvent) => void | Promise<void>,
): ReturnType<typeof runAgentLoopWithOutcome> {
	const context: AgentContext = { systemPrompt: "", messages: [], tools };
	let request = 0;
	let observationSequence = 0;
	const streamFn: StreamFn = () =>
		new MockAssistantStream(
			request++ === 0 ? assistantToolMessage(tools.map((tool) => tool.name)) : assistantDoneMessage(),
		);
	return runAgentLoopWithOutcome(
		[userMessage()],
		context,
		{
			model: createModel(),
			convertToLlm,
			toolExecution: "parallel",
			nextToolObservationSequence: () => ++observationSequence,
			...configOverrides,
		},
		(event) => {
			events.push(event);
			return onEvent?.(event);
		},
		undefined,
		streamFn,
	);
}

async function observeOneToolCall(
	toolCall: { id: string; name: string; arguments: Record<string, unknown> },
	tools: AgentTool[],
	configOverrides: Partial<AgentLoopConfig> = {},
): Promise<{
	observations: ToolOutcomeObservation[];
	events: AgentEvent[];
	result: Awaited<ReturnType<typeof runAgentLoopWithOutcome>>;
	requestCount: number;
}> {
	let request = 0;
	let observationSequence = 0;
	const streamFn: StreamFn = () => {
		const message =
			request++ === 0
				? { ...assistantToolMessage([]), content: [{ type: "toolCall" as const, ...toolCall }] }
				: assistantDoneMessage();
		return new MockAssistantStream(message);
	};
	const observations: ToolOutcomeObservation[] = [];
	const events: AgentEvent[] = [];
	const result = await runAgentLoopWithOutcome(
		[userMessage()],
		{ systemPrompt: "", messages: [], tools },
		{
			model: createModel(),
			convertToLlm,
			nextToolObservationSequence: () => ++observationSequence,
			observeToolOutcome: (observation) => {
				observations.push(observation);
			},
			...configOverrides,
		},
		(event) => events.push(event),
		undefined,
		streamFn,
	);
	return { observations, events, result, requestCount: request };
}

describe("S3 atomic parallel tool admission", () => {
	it("rejects every prepared sibling when source-order preflight latches pause", async () => {
		let latched = false;
		let preflightIndex = 0;
		const executeSpies = [vi.fn(), vi.fn(), vi.fn()];
		const tools = executeSpies.map((spy, index) =>
			createTool(`tool-${index + 1}`, async () => {
				spy();
				return successResult(`tool-${index + 1}`);
			}),
		);
		const events: AgentEvent[] = [];
		const observations: ToolOutcomeObservation[] = [];
		const result = await runToolBatch(
			tools,
			{
				beforeToolCall: async () => {
					preflightIndex += 1;
					if (preflightIndex === 2) latched = true;
					return undefined;
				},
				beforeToolEffect: ({ effect }) =>
					latched ? { kind: "paused", pause: { pauseId: "pause-preflight" } } : { kind: "admitted", effect },
				observeToolOutcome: (observation) => {
					observations.push(observation);
				},
			},
			events,
		);

		expect(executeSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
		expect(events.filter((event) => event.type === "external_effect_start")).toEqual([]);
		expect(events.filter((event) => event.type === "tool_execution_start")).toHaveLength(3);
		expect(events.filter((event) => event.type === "tool_execution_end")).toHaveLength(3);
		expect(observations.map((observation) => [observation.observationSequence, observation.toolCallId])).toEqual([
			[1, "call-1"],
			[2, "call-2"],
			[3, "call-3"],
		]);
		expect(observations.map((observation) => observation.kind)).toEqual([
			"guard_pause_block",
			"sibling_not_admitted",
			"sibling_not_admitted",
		]);
		expect(result.exit).toEqual({ kind: "paused", pauseId: "pause-preflight" });
	});

	it("allows only an already-admitted in-flight effect after its synchronous execute latches pause", async () => {
		let latched = false;
		const firstStarted = createDeferred<void>();
		const firstResult = createDeferred<ReturnType<typeof successResult>>();
		const executeSpies = [vi.fn(), vi.fn(), vi.fn()];
		const tools = [
			createTool("tool-1", () => {
				executeSpies[0]();
				latched = true;
				firstStarted.resolve();
				return firstResult.promise;
			}),
			createTool("tool-2", async () => {
				executeSpies[1]();
				return successResult("tool-2");
			}),
			createTool("tool-3", async () => {
				executeSpies[2]();
				return successResult("tool-3");
			}),
		];
		const events: AgentEvent[] = [];
		const run = runToolBatch(
			tools,
			{
				beforeToolEffect: ({ effect }) =>
					latched ? { kind: "paused", pause: { pauseId: "pause-in-flight" } } : { kind: "admitted", effect },
			},
			events,
		);

		await firstStarted.promise;
		expect(executeSpies.map((spy) => spy.mock.calls.length)).toEqual([1, 0, 0]);
		expect(events.filter((event) => event.type === "external_effect_start")).toHaveLength(1);
		firstResult.resolve(successResult("tool-1"));
		const result = await run;

		expect(executeSpies.map((spy) => spy.mock.calls.length)).toEqual([1, 0, 0]);
		expect(events.filter((event) => event.type === "external_effect_start")).toHaveLength(1);
		expect(events.filter((event) => event.type === "external_effect_end")).toHaveLength(1);
		expect(result.exit).toEqual({ kind: "paused", pauseId: "pause-in-flight" });
	});

	it("returns a typed cancelled loop exit without starting another provider request", async () => {
		const execute = vi.fn(async () => successResult("unexpected"));
		const events: AgentEvent[] = [];
		const result = await runToolBatch(
			[createTool("tool-1", execute)],
			{
				beforeToolEffect: () => ({ kind: "cancelled", reason: "operation_cancelled" }),
			},
			events,
		);
		expect(execute).not.toHaveBeenCalled();
		expect(result.exit).toEqual({ kind: "cancelled", reason: "operation_cancelled" });
		expect(events.filter((event) => event.type === "external_effect_start")).toEqual([]);
		expect(
			events.filter((event) => event.type === "message_start" && event.message.role === "assistant"),
		).toHaveLength(1);
		expect(events.at(-1)).toMatchObject({ type: "agent_end", outcome: "aborted" });
	});

	it("settles a started tool effect once when the async start emission rejects", async () => {
		const execute = vi.fn(async () => successResult("completed-after-start-event-failure"));
		const events: AgentEvent[] = [];

		await expect(
			runToolBatch(
				[createTool("tool-1", execute)],
				{ beforeToolEffect: ({ effect }) => ({ kind: "admitted", effect }) },
				events,
				async (event) => {
					if (event.type !== "external_effect_start") return;
					await Promise.resolve();
					throw new Error("start emission failed");
				},
			),
		).rejects.toThrow("start emission failed");

		expect(execute).toHaveBeenCalledTimes(1);
		expect(events.filter((event) => event.type === "external_effect_start")).toHaveLength(1);
		expect(events.filter((event) => event.type === "external_effect_end")).toEqual([
			expect.objectContaining({ type: "external_effect_end", outcome: "completed" }),
		]);
	});
});

describe("S3 source-ordered tool observations", () => {
	it("fingerprints repeated executed results with nested undefined detail fields", async () => {
		const controller = new ConvergenceController({
			taskRunId: "runtime-fingerprint",
			mode: "enforce",
			profileRevision: 1,
			limits: { exactRepeats: { pause: 10 } },
			maxWindowObservations: 8,
		});
		const observations: ToolOutcomeObservation[] = [];
		const executedResult = {
			content: [{ type: "text" as const, text: "same-result" }],
			details: { value: "same-result", nested: { stable: true, optional: undefined } },
		};
		const execute = vi.fn(async () => executedResult);
		const tool = createTool("same-tool", execute);
		const events: AgentEvent[] = [];

		await runToolBatch(
			[tool, tool],
			{
				observeToolOutcome: (observation) => {
					observations.push(observation);
					controller.observe(observation);
				},
			},
			events,
		);

		expect(execute).toHaveBeenCalledTimes(2);
		expect(observations.map((observation) => observation.resultFingerprint)).toEqual([
			expect.stringMatching(/^sha256:/),
			observations[0]?.resultFingerprint,
		]);
		expect(controller.snapshot.exactRepeatStreak).toBe(2);
		expect(executedResult.details.nested.optional).toBeUndefined();
		expect(Object.hasOwn(executedResult.details.nested, "optional")).toBe(true);
	});

	it("expresses guard replans and continues to exactly one next provider turn", async () => {
		const execute = vi.fn(async () => successResult("unexpected"));
		const tool = createTool("known", execute);
		const { observations, result, requestCount } = await observeOneToolCall(
			{ id: "replan", name: "known", arguments: { value: "valid" } },
			[tool],
			{ beforeToolEffect: () => ({ kind: "replan_required", reason: "Change strategy before retrying" }) },
		);
		expect(execute).not.toHaveBeenCalled();
		expect(observations[0]).toMatchObject({ kind: "guard_replan_block", errorClass: "guard_block" });
		expect(requestCount).toBe(2);
		expect(result.exit).toEqual({ kind: "completed" });
	});

	it("blocks later sequential siblings when an executed observation requires replanning", async () => {
		const executeFirst = vi.fn(async () => successResult("repeat"));
		const executeSecond = vi.fn(async () => successResult("must-not-run"));
		const observations: ToolOutcomeObservation[] = [];
		const events: AgentEvent[] = [];

		const result = await runToolBatch(
			[createTool("tool-1", executeFirst), createTool("tool-2", executeSecond)],
			{
				toolExecution: "sequential",
				beforeToolEffect: ({ effect }) => ({ kind: "admitted", effect }),
				observeToolOutcome: (observation) => {
					observations.push(observation);
					return observation.toolCallId === "call-1" ? { kind: "replan_required" } : undefined;
				},
			},
			events,
		);

		expect(executeFirst).toHaveBeenCalledTimes(1);
		expect(executeSecond).not.toHaveBeenCalled();
		expect(events.filter((event) => event.type === "external_effect_start")).toHaveLength(1);
		expect(observations.map((observation) => observation.kind)).toEqual(["executed", "sibling_not_admitted"]);
		expect(result.exit).toEqual({ kind: "completed" });
	});

	it("prioritizes the replan provider turn over tool termination and shouldStopAfterTurn", async () => {
		const tool = createTool("known", async () => ({ ...successResult("done"), terminate: true }));
		const shouldStopAfterTurn = vi.fn(() => true);
		const { requestCount, result } = await observeOneToolCall(
			{ id: "replan-after-terminate", name: "known", arguments: { value: "valid" } },
			[tool],
			{
				observeToolOutcome: () => ({ kind: "replan_required" }),
				shouldStopAfterTurn,
			},
		);

		expect(requestCount).toBe(2);
		expect(shouldStopAfterTurn).toHaveBeenCalledTimes(1);
		expect(result.exit).toEqual({ kind: "completed" });
	});

	it("commits observations before finalized tool and message events", async () => {
		const order: string[] = [];
		const events: AgentEvent[] = [];
		await runToolBatch(
			[createTool("tool-1", async () => successResult("done"))],
			{
				beforeToolEffect: ({ effect }) => ({ kind: "admitted", effect }),
				observeToolOutcome: (observation) => {
					order.push(`observe:${observation.toolCallId}`);
				},
			},
			events,
			(event) => {
				if (event.type === "tool_execution_end") order.push(`tool_end:${event.toolCallId}`);
				if (event.type === "message_start" && event.message.role === "toolResult") {
					order.push(`message:${event.message.toolCallId}`);
				}
			},
		);
		expect(order).toEqual(["observe:call-1", "tool_end:call-1", "message:call-1"]);
	});

	it("classifies immediate outcomes and re-validates extension mutations", async () => {
		const execute = vi.fn(async () => successResult("executed"));
		const tool = createTool("known", execute);
		const cases: Array<{
			name: string;
			arguments: Record<string, unknown>;
			config?: Partial<AgentLoopConfig>;
			expectedKind: ToolOutcomeObservation["kind"];
			expectedErrorClass: ToolOutcomeObservation["errorClass"];
		}> = [
			{
				name: "missing",
				arguments: {},
				expectedKind: "unknown_tool",
				expectedErrorClass: "unknown_tool",
			},
			{
				name: "known",
				arguments: {},
				expectedKind: "invalid_arguments",
				expectedErrorClass: "invalid_arguments",
			},
			{
				name: "known",
				arguments: { value: "valid" },
				config: {
					beforeToolCall: async ({ args }) => {
						delete (args as { value?: string }).value;
						return undefined;
					},
				},
				expectedKind: "invalid_arguments_after_extension",
				expectedErrorClass: "invalid_arguments_after_extension",
			},
			{
				name: "known",
				arguments: { value: "valid" },
				config: { beforeToolCall: async () => ({ block: true, reason: "policy" }) },
				expectedKind: "extension_block",
				expectedErrorClass: "policy_block",
			},
			{
				name: "known",
				arguments: { value: "valid" },
				config: {
					beforeToolCall: async () => {
						throw new Error("extension failed");
					},
				},
				expectedKind: "extension_hook_failure",
				expectedErrorClass: "extension_hook_failure",
			},
		];

		for (const [index, entry] of cases.entries()) {
			const { observations } = await observeOneToolCall(
				{ id: `case-${index}`, name: entry.name, arguments: entry.arguments },
				[tool],
				entry.config,
			);
			expect(observations).toHaveLength(1);
			expect(observations[0]).toMatchObject({
				observationSequence: 1,
				kind: entry.expectedKind,
				errorClass: entry.expectedErrorClass,
				isErrorForModel: true,
			});
		}
		expect(execute).not.toHaveBeenCalled();
	});

	it("observes guard blocks as model errors without starting an external effect", async () => {
		const execute = vi.fn(async () => successResult("unexpected"));
		const tool = createTool("known", execute);
		const { observations, events } = await observeOneToolCall(
			{ id: "guarded", name: "known", arguments: { value: "valid" } },
			[tool],
			{
				beforeToolEffect: () => ({ kind: "paused", pause: { pauseId: "guard-pause" } }),
			},
		);
		expect(execute).not.toHaveBeenCalled();
		expect(events.filter((event) => event.type === "external_effect_start")).toEqual([]);
		expect(observations[0]).toMatchObject({
			kind: "guard_pause_block",
			errorClass: "guard_block",
			isErrorForModel: true,
		});
	});
});
