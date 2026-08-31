import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	admitConvergenceEffect,
	advanceConvergenceTime,
	beginConvergenceStrategyEpoch,
	ConvergenceClassifierRegistry,
	ConvergenceController,
	type ConvergenceDecision,
	type ConvergenceLimits,
	type ConvergenceTaskSnapshot,
	canonicalJson,
	completeConvergenceReplanTurn,
	createCallFingerprint,
	createConvergenceTaskSnapshot,
	hashCanonicalJson,
	installConvergencePermit,
	observeToolOutcome,
	recordConvergenceUsage,
	type ToolOutcomeObservation,
	updateConvergenceLimits,
	validateConvergenceLimits,
} from "../../src/convergence/index.ts";
import { readTraceFixtureDirectory } from "./trace-reader.ts";
import type { ConvergenceTraceCase, TraceExpectation } from "./trace-schema.ts";

const FIXTURE_DIRECTORY = resolve(import.meta.dirname, "../fixtures/convergence");
const TEST_LIMITS: ConvergenceLimits = {
	toolCalls: { warn: 100, pause: 200 },
	toolErrors: { warn: 50, pause: 100 },
	activeElapsedMs: { warn: 1_000_000, pause: 2_000_000 },
	uncachedTokens: { warn: 10_000_000, pause: 20_000_000 },
	exactRepeats: { warn: 2, replan: 3, pause: 5 },
	noProgressObservations: { warn: 10, replan: 15, pause: 20 },
};

function snapshot(
	overrides: Partial<Parameters<typeof createConvergenceTaskSnapshot>[0]> = {},
): ConvergenceTaskSnapshot {
	return createConvergenceTaskSnapshot({
		taskRunId: "test-task",
		mode: "enforce",
		profileRevision: 1,
		limits: TEST_LIMITS,
		maxWindowObservations: 32,
		...overrides,
	});
}

function observation(sequence: number, overrides: Partial<ToolOutcomeObservation> = {}): ToolOutcomeObservation {
	return {
		observationSequence: sequence,
		toolCallId: `call-${sequence}`,
		toolName: "search",
		kind: "executed",
		errorClass: "tool_execution_error",
		callFingerprint: "sha256:call",
		resultFingerprint: "sha256:result",
		isErrorForModel: true,
		progress: "no_progress",
		...overrides,
	};
}

function replayObservation(
	current: ConvergenceTaskSnapshot,
	input: {
		sequence: number;
		toolName: string;
		callHash: string;
		resultHash: string;
		outcome: "success" | "tool_error";
	},
): ReturnType<typeof observeToolOutcome> {
	const previous = current.observations.at(-1);
	const changedResult = previous?.resultFingerprint !== input.resultHash;
	return observeToolOutcome(current, {
		observationSequence: input.sequence,
		toolCallId: `fixture-${input.sequence}`,
		toolName: input.toolName,
		kind: "executed",
		errorClass: input.outcome === "tool_error" ? "tool_execution_error" : "none",
		callFingerprint: input.callHash,
		resultFingerprint: input.resultHash,
		isErrorForModel: input.outcome === "tool_error",
		progress: input.outcome === "tool_error" ? "no_progress" : changedResult ? "progress" : "unknown",
	});
}

describe("convergence canonicalization", () => {
	it("sorts keys by UTF-16 code units, preserves arrays, and normalizes negative zero", () => {
		expect(canonicalJson({ z: -0, a: [3, 2, 1], B: true })).toBe('{"B":true,"a":[3,2,1],"z":0}');
		expect(createCallFingerprint("search", { b: 2, a: 1 })).toBe(createCallFingerprint("search", { a: 1, b: 2 }));
		expect(hashCanonicalJson({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, undefined, 1n])("rejects non-JSON value %s", (value) => {
		expect(() => canonicalJson(value)).toThrow(TypeError);
	});

	it("rejects circular objects and sparse arrays", () => {
		const circular: { self?: unknown } = {};
		circular.self = circular;
		expect(() => canonicalJson(circular)).toThrow(/circular/);
		expect(() => canonicalJson(Array(1))).toThrow(/sparse/);
	});
});

describe("ConvergenceController reducer", () => {
	it("is byte-equivalent for the same snapshot and ordered inputs", () => {
		const initial = snapshot();
		const left = observeToolOutcome(initial, observation(1));
		const right = observeToolOutcome(initial, observation(1));
		expect(JSON.stringify(left)).toBe(JSON.stringify(right));
		expect(initial.counters.toolCalls).toBe(0);
	});

	it("uses equality at settle, and projected greater-than at admission", () => {
		let current = snapshot({ limits: { toolCalls: { warn: 1, pause: 2 } } });
		current = observeToolOutcome(current, observation(1, { progress: "progress", errorClass: "none" })).snapshot;
		expect(current.state).toBe("active");
		const second = admitConvergenceEffect(current, { effectKind: "tool" });
		expect(second.kind).toBe("admitted");
		const settled = observeToolOutcome(second.snapshot, observation(2, { progress: "progress", errorClass: "none" }));
		expect(settled.snapshot.state).toBe("paused");
		expect(settled.decisions[0]).toMatchObject({ kind: "paused", metric: "toolCalls", value: 2, limit: 2 });
	});

	it("caps stagnation streaks to the FIFO while preserving cumulative budgets", () => {
		let current = snapshot({
			maxWindowObservations: 2,
			limits: { exactRepeats: { replan: 10, pause: 20 }, noProgressObservations: { replan: 10, pause: 20 } },
		});
		for (let sequence = 1; sequence <= 3; sequence += 1) {
			current = observeToolOutcome(current, observation(sequence)).snapshot;
		}
		expect(current.observations).toHaveLength(2);
		expect(current.exactRepeatStreak).toBe(2);
		expect(current.noProgressStreak).toBe(2);
		expect(current.counters).toMatchObject({
			toolCalls: 3,
			toolErrors: 3,
			exactRepeats: 2,
			noProgressObservations: 3,
		});
	});

	it("applies the accounting table independently of model-facing error flags", () => {
		let current = snapshot({ limits: {} });
		current = observeToolOutcome(
			current,
			observation(1, {
				kind: "guard_pause_block",
				errorClass: "guard_block",
				isErrorForModel: true,
				progress: "no_progress",
			}),
		).snapshot;
		expect(current.counters).toMatchObject({
			toolCalls: 1,
			toolErrors: 0,
			exactRepeats: 0,
			noProgressObservations: 0,
		});
		expect(current.observations[0]?.progress).toBe("unknown");
		current = observeToolOutcome(
			current,
			observation(2, {
				kind: "unknown_tool",
				errorClass: "none",
				isErrorForModel: false,
				progress: "unknown",
			}),
		).snapshot;
		expect(current.counters).toMatchObject({ toolCalls: 2, toolErrors: 1, noProgressObservations: 1 });
		expect(current.observations[1]?.progress).toBe("no_progress");
	});

	it("resets only epoch-scoped state", () => {
		let current = observeToolOutcome(snapshot(), observation(1)).snapshot;
		current = observeToolOutcome(current, observation(2)).snapshot;
		const next = beginConvergenceStrategyEpoch(current);
		expect(next.strategyEpoch).toBe(1);
		expect(next.observations).toEqual([]);
		expect(next.exactRepeatStreak).toBe(0);
		expect(next.counters.toolCalls).toBe(2);
		expect(next.observationSequence).toBe(2);
	});

	it("does not let a strategy epoch reset bypass a pause latch", () => {
		const current = observeToolOutcome(
			snapshot({ limits: { toolCalls: { pause: 1 } } }),
			observation(1, { progress: "progress", errorClass: "none" }),
		).snapshot;
		const pauseId = current.pauseId;

		expect(current.state).toBe("paused");
		expect(() => beginConvergenceStrategyEpoch(current)).toThrow(/resolve the pause explicitly/);
		expect(current).toMatchObject({ state: "paused", pauseId });
	});

	it("requires an explicit replan turn before same-cause escalation", () => {
		let current = snapshot();
		current = observeToolOutcome(current, observation(1)).snapshot;
		current = observeToolOutcome(current, observation(2)).snapshot;
		const replan = observeToolOutcome(current, observation(3));
		expect(replan.decisions[0]?.kind).toBe("replan_required");
		const waiting = observeToolOutcome(replan.snapshot, observation(4));
		expect(waiting.decisions).toEqual([]);
		current = completeConvergenceReplanTurn(waiting.snapshot);
		const escalated = admitConvergenceEffect(current, { effectKind: "tool", callFingerprint: "sha256:call" });
		expect(escalated.kind).toBe("paused");
	});

	it("projects decisions in observe mode without setting a latch", () => {
		let current = snapshot({ mode: "observe" });
		current = observeToolOutcome(current, observation(1)).snapshot;
		current = observeToolOutcome(current, observation(2)).snapshot;
		const transition = observeToolOutcome(current, observation(3));
		expect(transition.decisions[0]?.kind).toBe("would_replan");
		expect(transition.snapshot.state).toBe("active");
	});

	it("keeps off mode accounting but emits no decisions", () => {
		let current = snapshot({ mode: "off", limits: { toolCalls: { pause: 1 } } });
		const transition = observeToolOutcome(current, observation(1));
		current = transition.snapshot;
		expect(transition.decisions).toEqual([]);
		expect(current.counters.toolCalls).toBe(1);
		expect(current.state).toBe("active");
	});

	it("deduplicates usage IDs, records missing usage, and rejects overflow", () => {
		let current = snapshot({ limits: {} });
		const entry = {
			usageEntryId: "effect-1:provider",
			source: "provider",
			usage: { input: 10, output: 4, cacheWrite: 3, cacheRead: 20 },
		};
		current = recordConvergenceUsage(current, entry).snapshot;
		current = recordConvergenceUsage(current, entry).snapshot;
		expect(current.counters).toMatchObject({ uncachedTokens: 17, cacheReadTokens: 20 });
		current = recordConvergenceUsage(current, { usageEntryId: "effect-2:provider", source: "fallback" }).snapshot;
		expect(current.usageKnown).toBe(false);
		expect(current.missingUsageSources).toEqual(["fallback"]);
		expect(() =>
			recordConvergenceUsage(current, {
				usageEntryId: "effect-3:provider",
				source: "provider",
				usage: { input: Number.MAX_SAFE_INTEGER, output: 1, cacheRead: 0, cacheWrite: 0 },
			}),
		).toThrow(RangeError);
	});

	it("updates limits atomically with CAS and restores profile fields with null", () => {
		const initial = snapshot();
		const updated = updateConvergenceLimits(initial, { toolCalls: { pause: 300 }, toolErrors: null }, 0);
		expect(updated.kind).toBe("updated");
		if (updated.kind !== "updated") throw new Error("expected updated result");
		expect(updated.snapshot.limitRevision).toBe(1);
		expect(updated.snapshot.limits.toolCalls?.pause).toBe(300);
		expect(updated.snapshot.limits.toolErrors).toEqual(TEST_LIMITS.toolErrors);
		const stale = updateConvergenceLimits(updated.snapshot, { toolCalls: { pause: 400 } }, 0);
		expect(stale).toEqual({ kind: "stale", expectedLimitRevision: 0, actualLimitRevision: 1 });
		expect(updated.snapshot.limits.toolCalls?.pause).toBe(300);
	});

	it("consumes an allow-once permit exactly once", () => {
		let current = snapshot({ limits: { toolCalls: { pause: 1 } } });
		current = observeToolOutcome(current, observation(1, { progress: "progress", errorClass: "none" })).snapshot;
		expect(current.pauseId).toBeDefined();
		current = installConvergencePermit(current, {
			permitId: "permit-1",
			pauseId: current.pauseId ?? "",
			causeSignature: current.latchedDecision?.causeSignature ?? "",
			effectKind: "provider_request",
		});
		const allowed = admitConvergenceEffect(current, { effectKind: "provider_request" });
		expect(allowed).toMatchObject({ kind: "admitted", permitConsumed: true });
		const blocked = admitConvergenceEffect(allowed.snapshot, { effectKind: "provider_request" });
		expect(blocked.kind).toBe("paused");
	});

	it("validates tier shape and safe integers as a table", () => {
		const invalid: ConvergenceLimits[] = [
			{ toolCalls: { replan: 2, pause: 3 } },
			{ exactRepeats: { warn: 3, replan: 2, pause: 4 } },
			{ exactRepeats: { pause: 0 } },
			{ toolErrors: { pause: Number.MAX_SAFE_INTEGER + 1 } },
		];
		for (const limits of invalid) expect(() => validateConvergenceLimits(limits)).toThrow(TypeError);
	});

	it("uses an injected monotonic clock and rejects time regression", () => {
		let now = 100;
		const controller = new ConvergenceController(
			{
				taskRunId: "clock-task",
				mode: "enforce",
				profileRevision: 1,
				limits: { activeElapsedMs: { pause: 20 } },
				maxWindowObservations: 4,
			},
			() => now,
		);
		now = 120;
		expect(controller.tick()[0]).toMatchObject({ kind: "paused", metric: "activeElapsedMs" });
		now = 119;
		expect(() => controller.tick()).toThrow(/must not move backwards/);
	});

	it("advances the monotonic clock origin without accumulating active time while paused", () => {
		let now = 100;
		const controller = new ConvergenceController(
			{
				taskRunId: "paused-clock-task",
				mode: "enforce",
				profileRevision: 1,
				limits: { activeElapsedMs: { pause: 20 } },
				maxWindowObservations: 4,
			},
			() => now,
		);
		now = 120;
		controller.tick();
		expect(controller.snapshot.counters.activeElapsedMs).toBe(20);
		now = 1_120;
		expect(controller.tick()).toEqual([]);
		expect(controller.snapshot.counters.activeElapsedMs).toBe(20);
		now = 1_125;
		expect(controller.tick()).toEqual([]);
		expect(controller.snapshot.counters.activeElapsedMs).toBe(20);
	});

	it("defaults unknown tools to unknown progress and supports explicit trusted classifiers", () => {
		const registry = new ConvergenceClassifierRegistry();
		const input = { toolName: "third-party", kind: "executed", errorClass: "none" } as const;
		expect(registry.classify(input)).toBe("unknown");
		const unregister = registry.register("third-party", () => "progress");
		expect(registry.classify(input)).toBe("progress");
		unregister();
		expect(registry.classify(input)).toBe("unknown");
	});
});

describe("convergence trace replay", () => {
	type ReplayDecision = { sequence: number; source: "time" | "observation" | "usage"; decision: ConvergenceDecision };

	function replayTrace(trace: ConvergenceTraceCase): {
		snapshot: ConvergenceTaskSnapshot;
		decisions: ReplayDecision[];
	} {
		let current = snapshot({ taskRunId: trace.id });
		let previousRelativeMs = 0;
		const decisions: ReplayDecision[] = [];
		const collect = (
			sequence: number,
			source: ReplayDecision["source"],
			transition: { snapshot: ConvergenceTaskSnapshot; decisions: ConvergenceDecision[] },
		): void => {
			current = transition.snapshot;
			for (const decision of transition.decisions) decisions.push({ sequence, source, decision });
		};

		for (const entry of trace.observations) {
			collect(entry.sequence, "time", advanceConvergenceTime(current, entry.relativeMs - previousRelativeMs));
			previousRelativeMs = entry.relativeMs;
			collect(entry.sequence, "observation", replayObservation(current, entry));
			collect(
				entry.sequence,
				"usage",
				recordConvergenceUsage(current, {
					usageEntryId: `${trace.id}:${entry.sequence}:tool_outcome`,
					source: "trace_fixture",
					usage: entry.usage,
				}),
			);
		}
		return { snapshot: current, decisions };
	}

	function matchesExpectation(
		entry: ReplayDecision,
		expectation: Extract<TraceExpectation, { type: "decision" }>,
	): boolean {
		const kinds: Record<typeof expectation.level, ConvergenceDecision["kind"][]> = {
			warning: ["warning"],
			replan: ["replan_required", "would_replan"],
			pause: ["paused", "would_pause"],
		};
		return (
			entry.sequence <= expectation.atOrBeforeSequence &&
			entry.decision.reason === expectation.reason &&
			kinds[expectation.level].includes(entry.decision.kind)
		);
	}

	it("replays the sanitized incident and all negative controls deterministically", () => {
		const { cases } = readTraceFixtureDirectory(FIXTURE_DIRECTORY);
		for (const trace of cases) {
			const first = replayTrace(trace);
			const second = replayTrace(trace);
			expect(JSON.stringify(second)).toBe(JSON.stringify(first));
			const firstPauseSequence = first.decisions.find(
				({ decision }) => decision.kind === "paused" || decision.kind === "would_pause",
			)?.sequence;
			const activeThrough = firstPauseSequence ?? trace.observations.at(-1)?.sequence ?? 0;
			expect(first.snapshot.counters.activeElapsedMs).toBe(
				trace.observations.find(({ sequence }) => sequence === activeThrough)?.relativeMs ?? 0,
			);
			expect(first.snapshot.counters.uncachedTokens).toBe(
				trace.observations.reduce((total, { usage }) => total + usage.input + usage.output + usage.cacheWrite, 0),
			);
			expect(first.snapshot.consumedUsageEntryIds).toHaveLength(trace.observations.length);

			for (const expectation of trace.expectations) {
				if (expectation.type === "decision") {
					expect(
						first.decisions.some((entry) => matchesExpectation(entry, expectation)),
						`${trace.id} did not satisfy ${expectation.level}/${expectation.reason} by sequence ${expectation.atOrBeforeSequence}`,
					).toBe(true);
				} else {
					expect(
						first.decisions.some(
							({ sequence, decision }) =>
								sequence <= expectation.sequence &&
								(decision.kind === "paused" || decision.kind === "would_pause"),
						),
						`${trace.id} paused at or before protected sequence ${expectation.sequence}`,
					).toBe(false);
				}
			}
		}
	});
});
