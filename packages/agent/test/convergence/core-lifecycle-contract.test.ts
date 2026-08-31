import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
} from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { Agent } from "../../src/agent.ts";
import {
	type AgentEventSink,
	agentLoop,
	agentLoopContinue,
	runAgentLoop,
	runAgentLoopContinue,
	runAgentLoopContinueWithOutcome,
	runAgentLoopWithOutcome,
} from "../../src/agent-loop.ts";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentLoopResult,
	AgentMessage,
	EffectRef,
	StreamFn,
} from "../../src/types.ts";

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
		queueMicrotask(() => this.push({ type: "done", reason: "stop", message }));
	}
}

class ThrowingIteratorStream extends MockAssistantStream {
	override [Symbol.asyncIterator](): AsyncIterableIterator<AssistantMessageEvent> {
		return {
			next: async () => {
				throw new Error("iterator failed");
			},
			[Symbol.asyncIterator]() {
				return this;
			},
		};
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

function createAssistantMessage(): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "done" }],
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
		stopReason: "stop",
		timestamp: 1,
	};
}

function createUserMessage(): AgentMessage {
	return { role: "user", content: [{ type: "text", text: "go" }], timestamp: 0 };
}

function convertToLlm(messages: AgentMessage[]): Message[] {
	return messages.filter(
		(message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult",
	);
}

function createConfig(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
	return { model: createModel(), convertToLlm, ...overrides };
}

const streamFn: StreamFn = () => new MockAssistantStream(createAssistantMessage());

describe("S1 low-level compatibility", () => {
	it("preserves the four existing low-level return contracts", () => {
		const legacyLoop: (
			prompts: AgentMessage[],
			context: AgentContext,
			config: AgentLoopConfig,
			signal: AbortSignal | undefined,
			stream: StreamFn,
		) => EventStream<AgentEvent, AgentMessage[]> = agentLoop;
		const legacyContinue: (
			context: AgentContext,
			config: AgentLoopConfig,
			signal: AbortSignal | undefined,
			stream: StreamFn,
		) => EventStream<AgentEvent, AgentMessage[]> = agentLoopContinue;
		const legacyRun: (
			prompts: AgentMessage[],
			context: AgentContext,
			config: AgentLoopConfig,
			emit: AgentEventSink,
			signal: AbortSignal | undefined,
			stream: StreamFn,
		) => Promise<AgentMessage[]> = runAgentLoop;
		const legacyRunContinue: (
			context: AgentContext,
			config: AgentLoopConfig,
			emit: AgentEventSink,
			signal: AbortSignal | undefined,
			stream: StreamFn,
		) => Promise<AgentMessage[]> = runAgentLoopContinue;

		expect(legacyLoop).toBe(agentLoop);
		expect(legacyContinue).toBe(agentLoopContinue);
		expect(legacyRun).toBe(runAgentLoop);
		expect(legacyRunContinue).toBe(runAgentLoopContinue);
	});

	it("returns messages through the legacy helper and a typed result through the additive helper", async () => {
		const context: AgentContext = { systemPrompt: "", messages: [], tools: [] };
		const legacyMessages = await runAgentLoop(
			[createUserMessage()],
			context,
			createConfig(),
			() => {},
			undefined,
			streamFn,
		);
		const typedResult: AgentLoopResult = await runAgentLoopWithOutcome(
			[createUserMessage()],
			context,
			createConfig(),
			() => {},
			undefined,
			streamFn,
		);

		expect(legacyMessages.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(typedResult.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(typedResult.exit).toEqual({ kind: "completed" });
	});
});

describe("S1 provider request admission", () => {
	it("resolves credentials before the final admission boundary but does not dispatch when paused", async () => {
		const events: AgentEvent[] = [];
		const getApiKey = vi.fn(() => "secret");
		const dispatch = vi.fn(streamFn);
		const result = await runAgentLoopWithOutcome(
			[createUserMessage()],
			{ systemPrompt: "", messages: [], tools: [] },
			createConfig({
				getApiKey,
				beforeRequest: () => ({ kind: "paused", pause: { pauseId: "pause-1" } }),
			}),
			(event) => {
				events.push(event);
			},
			undefined,
			dispatch,
		);

		expect(result.exit).toEqual({ kind: "paused", pauseId: "pause-1" });
		expect(result.messages.map((message) => message.role)).toEqual(["user"]);
		expect(getApiKey).toHaveBeenCalledOnce();
		expect(dispatch).not.toHaveBeenCalled();
		expect(events.filter((event) => event.type.startsWith("external_effect_"))).toEqual([]);
		expect(events.at(-1)).toEqual({
			type: "agent_end",
			messages: [createUserMessage()],
			outcome: "paused",
			pauseId: "pause-1",
		});
	});

	it("maps a cancelled admission to the existing aborted lifecycle", async () => {
		const events: AgentEvent[] = [];
		const dispatch = vi.fn(streamFn);
		const result = await runAgentLoopWithOutcome(
			[createUserMessage()],
			{ systemPrompt: "", messages: [], tools: [] },
			createConfig({
				beforeRequest: () => ({ kind: "cancelled", reason: "operation_cancelled" }),
			}),
			(event) => {
				events.push(event);
			},
			undefined,
			dispatch,
		);

		expect(result.exit).toEqual({ kind: "cancelled", reason: "operation_cancelled" });
		expect(dispatch).not.toHaveBeenCalled();
		expect(events.at(-1)).toMatchObject({ type: "agent_end", outcome: "aborted" });
	});

	it("keeps fallback effect IDs and sequences unique across loop invocations", async () => {
		const effects: EffectRef[] = [];
		const config = createConfig({
			taskRunId: "shared-task",
			beforeRequest: ({ effect }) => {
				effects.push(effect);
				return { kind: "paused", pause: { pauseId: `pause-${effects.length}` } };
			},
		});
		for (let invocation = 0; invocation < 2; invocation += 1) {
			await runAgentLoopWithOutcome(
				[createUserMessage()],
				{ systemPrompt: "", messages: [], tools: [] },
				config,
				() => {},
				undefined,
				streamFn,
			);
		}
		expect(effects).toHaveLength(2);
		expect(effects[1].sequence).toBeGreaterThan(effects[0].sequence);
		expect(effects[1].effectId).not.toBe(effects[0].effectId);
	});

	it("emits one external effect start/end pair around an admitted dispatch", async () => {
		const effect: EffectRef = {
			effectId: "task-1:provider_request:7",
			kind: "provider_request",
			taskRunId: "task-1",
			sequence: 7,
		};
		const observedOrder: string[] = [];
		const result = await runAgentLoopWithOutcome(
			[createUserMessage()],
			{ systemPrompt: "", messages: [], tools: [] },
			createConfig({
				convertToLlm: (messages) => {
					observedOrder.push("convert");
					return convertToLlm(messages);
				},
				createEffectRef: () => effect,
				beforeRequest: (context) => {
					observedOrder.push("admit");
					expect(context.effect).toEqual(effect);
					return { kind: "admitted", effect };
				},
				getApiKey: () => {
					observedOrder.push("credentials");
					return "secret";
				},
			}),
			(event) => {
				if (event.type === "external_effect_start") observedOrder.push("effect_start");
				if (event.type === "external_effect_end") observedOrder.push(`effect_end:${event.outcome}`);
			},
			undefined,
			() => {
				observedOrder.push("dispatch");
				return new MockAssistantStream(createAssistantMessage());
			},
		);

		expect(result.exit).toEqual({ kind: "completed" });
		expect(observedOrder).toEqual([
			"convert",
			"credentials",
			"admit",
			"effect_start",
			"dispatch",
			"effect_end:completed",
		]);
	});

	it("pairs an admitted effect when the async iterator throws", async () => {
		const events: AgentEvent[] = [];
		await expect(
			runAgentLoopWithOutcome(
				[createUserMessage()],
				{ systemPrompt: "", messages: [], tools: [] },
				createConfig({ beforeRequest: ({ effect }) => ({ kind: "admitted", effect }) }),
				(event) => events.push(event),
				undefined,
				() => new ThrowingIteratorStream(createAssistantMessage()),
			),
		).rejects.toThrow("iterator failed");
		expect(events.filter((event) => event.type === "external_effect_start")).toHaveLength(1);
		expect(events.filter((event) => event.type === "external_effect_end")).toEqual([
			expect.objectContaining({ type: "external_effect_end", outcome: "error" }),
		]);
	});

	it("supports the outcome-aware continuation helper without changing the legacy continuation", async () => {
		const legacyContext: AgentContext = { systemPrompt: "", messages: [createUserMessage()], tools: [] };
		const typedContext: AgentContext = { systemPrompt: "", messages: [createUserMessage()], tools: [] };
		const legacy = await runAgentLoopContinue(legacyContext, createConfig(), () => {}, undefined, streamFn);
		const typed = await runAgentLoopContinueWithOutcome(typedContext, createConfig(), () => {}, undefined, streamFn);

		expect(legacy.map((message) => message.role)).toEqual(["assistant"]);
		expect(typed.exit).toEqual({ kind: "completed" });
		expect(typed.messages.map((message) => message.role)).toEqual(["assistant"]);
	});
});

describe("S1 Agent outcome lifecycle", () => {
	it("returns a typed pause without creating an assistant error", async () => {
		const dispatch = vi.fn(streamFn);
		const events: AgentEvent[] = [];
		const agent = new Agent({
			streamFn: dispatch,
			beforeRequest: () => ({ kind: "paused", pause: { pauseId: "pause-agent" } }),
		});
		agent.subscribe((event) => {
			events.push(event);
		});

		const outcome = await agent.promptWithOutcome("go");

		expect(outcome).toEqual({ kind: "paused", pauseId: "pause-agent" });
		expect(dispatch).not.toHaveBeenCalled();
		expect(agent.state.isStreaming).toBe(false);
		expect(agent.state.errorMessage).toBeUndefined();
		expect(agent.state.messages.map((message) => message.role)).toEqual(["user"]);
		expect(events.at(-1)).toMatchObject({ type: "agent_end", outcome: "paused", pauseId: "pause-agent" });
	});
});
