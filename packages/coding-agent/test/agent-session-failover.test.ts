import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, getModel } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createAssistantMessage(text: string, overrides?: Partial<AssistantMessage>): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
		...overrides,
	};
}

describe("AgentSession failover", () => {
	let session: AgentSession;
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-failover-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (session) session.dispose();
		if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	it("fails over to another model after same-model retries are exhausted", async () => {
		const primaryModel = getModel("anthropic", "claude-sonnet-4-5")!;
		const primaryModelId = primaryModel.id;

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model: primaryModel, systemPrompt: "Test", tools: [] },
			// The primary model always fails with a retryable error; any other model succeeds.
			streamFn: () => {
				const activeModelId = agent.state.model?.id;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					if (activeModelId === primaryModelId) {
						const msg = createAssistantMessage("", {
							stopReason: "error",
							errorMessage: "fetch failed",
							model: activeModelId,
						});
						stream.push({ type: "start", partial: msg });
						stream.push({ type: "error", reason: "error", error: msg });
					} else {
						const msg = createAssistantMessage("Recovered on fallback model", { model: activeModelId });
						stream.push({ type: "start", partial: msg });
						stream.push({ type: "done", reason: "stop", message: msg });
					}
				});
				return stream;
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));

		await authStorage.modify("anthropic", async () => ({ type: "api_key", key: "test-key" }));
		const modelRegistry = await createModelRegistry(authStorage, tempDir);
		settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } });

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRuntime: getModelRuntime(modelRegistry),
			resourceLoader: createTestResourceLoader(),
		});

		// Failover needs at least one other authenticated model to switch to.
		const available = getModelRuntime(modelRegistry).getAvailableSnapshot();
		expect(available.length).toBeGreaterThan(1);

		const failovers: Array<{ from: string; to: string }> = [];
		session.subscribe((event) => {
			if (event.type === "model_failover") {
				failovers.push({ from: event.fromModel, to: event.toModel });
			}
		});

		await session.prompt("Test");

		// One failover occurred, away from the primary model, and the run then succeeded.
		expect(failovers).toHaveLength(1);
		expect(failovers[0].from).toBe(primaryModelId);
		expect(failovers[0].to).not.toBe(primaryModelId);
		expect(session.model?.id).not.toBe(primaryModelId);
		expect(session.isRetrying).toBe(false);
	});

	it("does not fail over when retry is disabled", async () => {
		const primaryModel = getModel("anthropic", "claude-sonnet-4-5")!;
		const primaryModelId = primaryModel.id;
		let callCount = 0;

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model: primaryModel, systemPrompt: "Test", tools: [] },
			streamFn: () => {
				callCount++;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					const msg = createAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" });
					stream.push({ type: "start", partial: msg });
					stream.push({ type: "error", reason: "error", error: msg });
				});
				return stream;
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));

		await authStorage.modify("anthropic", async () => ({ type: "api_key", key: "test-key" }));
		const modelRegistry = await createModelRegistry(authStorage, tempDir);
		settingsManager.applyOverrides({ retry: { enabled: false, maxRetries: 1, baseDelayMs: 1 } });

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRuntime: getModelRuntime(modelRegistry),
			resourceLoader: createTestResourceLoader(),
		});

		const failovers: string[] = [];
		session.subscribe((event) => {
			if (event.type === "model_failover") failovers.push(event.toModel);
		});

		await session.prompt("Test");

		// Retry disabled: no same-model retry and no failover; the error surfaces on the primary.
		expect(failovers).toHaveLength(0);
		expect(callCount).toBe(1);
		expect(session.model?.id).toBe(primaryModelId);
	});
});
