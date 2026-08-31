import type { EffectKind } from "../types.ts";
import { createCauseSignature, createObservationFingerprint, hashCanonicalJson } from "./canonicalizer.ts";
import {
	CONVERGENCE_CANONICALIZER_VERSION,
	CONVERGENCE_CONTROLLER_SCHEMA_VERSION,
	CONVERGENCE_CONTROLLER_VERSION,
	CONVERGENCE_HASH_ALGORITHM,
	type ConvergenceDecision,
	type ConvergenceEffectAdmission,
	type ConvergenceEffectRequest,
	type ConvergenceLimits,
	type ConvergenceLimitsPatch,
	type ConvergenceLimitUpdateResult,
	type ConvergenceMetric,
	type ConvergenceSnapshotOptions,
	type ConvergenceTaskSnapshot,
	type ConvergenceTransition,
	type ConvergenceUsageEntry,
	type MonotonicClock,
	type RecordedToolOutcomeObservation,
	type TieredLimit,
	type ToolOutcomeObservation,
} from "./types.ts";

const RESOURCE_METRICS = ["activeElapsedMs", "uncachedTokens", "toolCalls", "toolErrors"] as const;
const STAGNATION_METRICS = ["exactRepeats", "noProgressObservations"] as const;
const ALL_METRICS = [...RESOURCE_METRICS, ...STAGNATION_METRICS] as const;

function cloneLimit(limit: TieredLimit): TieredLimit {
	return { ...limit };
}

function cloneLimits(limits: ConvergenceLimits): ConvergenceLimits {
	return Object.fromEntries(Object.entries(limits).map(([metric, limit]) => [metric, cloneLimit(limit)]));
}

function cloneSnapshot(snapshot: ConvergenceTaskSnapshot): ConvergenceTaskSnapshot {
	return {
		...snapshot,
		profileLimits: cloneLimits(snapshot.profileLimits),
		limits: cloneLimits(snapshot.limits),
		counters: { ...snapshot.counters },
		missingUsageSources: [...snapshot.missingUsageSources],
		consumedUsageEntryIds: [...snapshot.consumedUsageEntryIds],
		observations: snapshot.observations.map((observation) => ({ ...observation })),
		warningDedupeKeys: [...snapshot.warningDedupeKeys],
		escalatedCauseSignatures: [...snapshot.escalatedCauseSignatures],
		pendingReplanDecision: snapshot.pendingReplanDecision ? { ...snapshot.pendingReplanDecision } : undefined,
		latchedDecision: snapshot.latchedDecision ? { ...snapshot.latchedDecision } : undefined,
		permit: snapshot.permit ? { ...snapshot.permit } : undefined,
	};
}

function assertPositiveSafeInteger(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive safe integer.`);
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer.`);
}

function safeAdd(left: number, right: number, label: string): number {
	const value = left + right;
	if (!Number.isSafeInteger(value)) throw new RangeError(`${label} exceeds the safe integer range.`);
	return value;
}

function validateTier(metric: ConvergenceMetric, limit: TieredLimit): void {
	assertPositiveSafeInteger(limit.pause, `${metric}.pause`);
	if (limit.warn !== undefined) assertPositiveSafeInteger(limit.warn, `${metric}.warn`);
	if (limit.replan !== undefined) assertPositiveSafeInteger(limit.replan, `${metric}.replan`);
	if (RESOURCE_METRICS.includes(metric as (typeof RESOURCE_METRICS)[number]) && limit.replan !== undefined) {
		throw new TypeError(`${metric} is a resource metric and cannot define replan.`);
	}
	const tiers = [limit.warn, limit.replan, limit.pause].filter((value): value is number => value !== undefined);
	for (let index = 1; index < tiers.length; index += 1) {
		if (tiers[index - 1] >= tiers[index]) throw new TypeError(`${metric} tiers must be strictly increasing.`);
	}
}

export function validateConvergenceLimits(limits: ConvergenceLimits): void {
	for (const metric of ALL_METRICS) {
		const limit = limits[metric];
		if (limit) validateTier(metric, limit);
	}
}

export function createConvergenceTaskSnapshot(options: ConvergenceSnapshotOptions): ConvergenceTaskSnapshot {
	if (!options.taskRunId.trim()) throw new TypeError("taskRunId must not be empty.");
	assertPositiveSafeInteger(options.profileRevision, "profileRevision");
	assertPositiveSafeInteger(options.maxWindowObservations, "maxWindowObservations");
	validateConvergenceLimits(options.limits);
	const limits = cloneLimits(options.limits);
	return {
		schemaVersion: CONVERGENCE_CONTROLLER_SCHEMA_VERSION,
		controllerVersion: CONVERGENCE_CONTROLLER_VERSION,
		canonicalizerVersion: CONVERGENCE_CANONICALIZER_VERSION,
		hashAlgorithm: CONVERGENCE_HASH_ALGORITHM,
		taskRunId: options.taskRunId,
		mode: options.mode,
		profileRevision: options.profileRevision,
		state: "active",
		strategyEpoch: 0,
		observationSequence: 0,
		limitRevision: 0,
		maxWindowObservations: options.maxWindowObservations,
		profileLimits: cloneLimits(limits),
		limits,
		counters: {
			toolCalls: 0,
			toolErrors: 0,
			effectsAdmitted: 0,
			activeElapsedMs: 0,
			uncachedTokens: 0,
			cacheReadTokens: 0,
			noProgressObservations: 0,
			exactRepeats: 0,
		},
		accumulatedActiveMs: 0,
		usageKnown: true,
		missingUsageSources: [],
		consumedUsageEntryIds: [],
		observations: [],
		exactRepeatStreak: 0,
		noProgressStreak: 0,
		warningDedupeKeys: [],
		escalatedCauseSignatures: [],
		pauseCount: 0,
	};
}

function isRepeatEligible(observation: ToolOutcomeObservation): boolean {
	return !["guard_replan_block", "guard_pause_block", "sibling_not_admitted", "cancelled"].includes(observation.kind);
}

function isBudgetedError(observation: ToolOutcomeObservation): boolean {
	if (observation.kind === "executed") {
		return observation.errorClass === "tool_execution_error" || observation.errorClass === "provider_error";
	}
	return ["unknown_tool", "invalid_arguments", "invalid_arguments_after_extension", "extension_hook_failure"].includes(
		observation.kind,
	);
}

function accountedProgress(observation: ToolOutcomeObservation): ToolOutcomeObservation["progress"] {
	if (
		["guard_replan_block", "guard_pause_block", "sibling_not_admitted", "cancelled", "extension_block"].includes(
			observation.kind,
		)
	) {
		return "unknown";
	}
	if (
		["unknown_tool", "invalid_arguments", "invalid_arguments_after_extension", "extension_hook_failure"].includes(
			observation.kind,
		)
	) {
		return "no_progress";
	}
	return observation.progress;
}

function observationFingerprint(observation: ToolOutcomeObservation): string | undefined {
	if (!isRepeatEligible(observation) || !observation.callFingerprint) return undefined;
	if (observation.resultFingerprint) {
		return createObservationFingerprint(observation.callFingerprint, observation.resultFingerprint);
	}
	if (observation.kind === "executed") return undefined;
	return createObservationFingerprint(
		observation.callFingerprint,
		hashCanonicalJson({ kind: observation.kind, errorClass: observation.errorClass }),
	);
}

function recomputeWindowStreaks(snapshot: ConvergenceTaskSnapshot): void {
	let repeatFingerprint: string | undefined;
	let repeatStreak = 0;
	let noProgressStreak = 0;
	for (let index = snapshot.observations.length - 1; index >= 0; index -= 1) {
		const observation = snapshot.observations[index];
		if (observation.progress === "progress") break;
		if (observation.progress === "no_progress") noProgressStreak += 1;
		if (!observation.observationFingerprint) continue;
		if (repeatFingerprint === undefined) repeatFingerprint = observation.observationFingerprint;
		if (observation.observationFingerprint !== repeatFingerprint) break;
		repeatStreak += 1;
	}
	snapshot.lastObservationFingerprint = repeatFingerprint;
	snapshot.exactRepeatStreak = repeatStreak;
	snapshot.noProgressStreak = noProgressStreak;
}

function metricValue(snapshot: ConvergenceTaskSnapshot, metric: ConvergenceMetric): number {
	if (metric === "exactRepeats") return snapshot.exactRepeatStreak;
	if (metric === "noProgressObservations") return snapshot.noProgressStreak;
	return snapshot.counters[metric];
}

function reasonForMetric(metric: ConvergenceMetric): ConvergenceDecision["reason"] {
	if (metric === "exactRepeats") return "exact_repeat";
	if (metric === "noProgressObservations") return "no_progress";
	if (metric === "toolErrors") return "tool_error_budget";
	if (metric === "toolCalls") return "tool_call_budget";
	if (metric === "activeElapsedMs") return "active_time_budget";
	return "token_budget";
}

function detectorKey(snapshot: ConvergenceTaskSnapshot, metric: ConvergenceMetric): string {
	if (metric === "exactRepeats") return snapshot.lastObservationFingerprint ?? "missing-observation-fingerprint";
	if (metric === "noProgressObservations") return "default-classifier-group";
	return metric;
}

function decisionFor(
	snapshot: ConvergenceTaskSnapshot,
	metric: ConvergenceMetric,
	kind: ConvergenceDecision["kind"],
	value: number,
	limit: number,
): ConvergenceDecision {
	const reason = reasonForMetric(metric);
	return {
		kind,
		reason,
		causeSignature: createCauseSignature({
			reason,
			scope: snapshot.taskRunId,
			detectorKey: detectorKey(snapshot, metric),
			strategyEpoch: snapshot.strategyEpoch,
			limitRevision: snapshot.limitRevision,
		}),
		metric,
		value,
		limit,
	};
}

function pause(snapshot: ConvergenceTaskSnapshot, decision: ConvergenceDecision): ConvergenceDecision {
	const pauseCount = safeAdd(snapshot.pauseCount, 1, "pauseCount");
	const pauseId = `${snapshot.taskRunId}:pause:${pauseCount}`;
	const projectedKind = snapshot.mode === "observe" ? "would_pause" : "paused";
	const projected = { ...decision, kind: projectedKind, pauseId } satisfies ConvergenceDecision;
	if (snapshot.mode === "enforce") {
		snapshot.state = "paused";
		snapshot.pauseCount = pauseCount;
		snapshot.pauseId = pauseId;
		snapshot.latchedDecision = projected;
	}
	return projected;
}

function replan(snapshot: ConvergenceTaskSnapshot, decision: ConvergenceDecision): ConvergenceDecision {
	const projectedKind = snapshot.mode === "observe" ? "would_replan" : "replan_required";
	const projected = { ...decision, kind: projectedKind } satisfies ConvergenceDecision;
	snapshot.pendingReplanCause = decision.causeSignature;
	snapshot.pendingReplanDecision = projected;
	if (snapshot.mode === "enforce") snapshot.state = "replan_required";
	return projected;
}

function evaluate(snapshot: ConvergenceTaskSnapshot): ConvergenceDecision[] {
	if (snapshot.mode === "off" || snapshot.state === "paused") return [];

	for (const metric of ALL_METRICS) {
		const limit = snapshot.limits[metric];
		if (!limit) continue;
		const value = metricValue(snapshot, metric);
		if (value >= limit.pause) return [pause(snapshot, decisionFor(snapshot, metric, "paused", value, limit.pause))];
	}

	for (const metric of STAGNATION_METRICS) {
		const limit = snapshot.limits[metric];
		if (!limit?.replan) continue;
		const value = metricValue(snapshot, metric);
		if (value < limit.replan) continue;
		const candidate = decisionFor(snapshot, metric, "replan_required", value, limit.replan);
		if (snapshot.escalatedCauseSignatures.includes(candidate.causeSignature)) return [pause(snapshot, candidate)];
		if (snapshot.pendingReplanCause === candidate.causeSignature) return [];
		return [replan(snapshot, candidate)];
	}

	for (const metric of ALL_METRICS) {
		const limit = snapshot.limits[metric];
		if (!limit?.warn) continue;
		const value = metricValue(snapshot, metric);
		if (value < limit.warn) continue;
		const warning = decisionFor(snapshot, metric, "warning", value, limit.warn);
		const dedupeKey = `${warning.causeSignature}:warning`;
		if (snapshot.warningDedupeKeys.includes(dedupeKey)) continue;
		snapshot.warningDedupeKeys.push(dedupeKey);
		return [warning];
	}
	return [];
}

export function observeToolOutcome(
	current: ConvergenceTaskSnapshot,
	observation: ToolOutcomeObservation,
): ConvergenceTransition {
	const snapshot = cloneSnapshot(current);
	const expectedSequence = snapshot.observationSequence + 1;
	if (observation.observationSequence !== expectedSequence) {
		throw new TypeError(`observationSequence must be ${expectedSequence}.`);
	}
	snapshot.observationSequence = observation.observationSequence;

	snapshot.counters.toolCalls = safeAdd(snapshot.counters.toolCalls, 1, "toolCalls");
	if (isBudgetedError(observation)) {
		snapshot.counters.toolErrors = safeAdd(snapshot.counters.toolErrors, 1, "toolErrors");
	}

	const normalizedObservation = { ...observation, progress: accountedProgress(observation) };
	const fingerprint = observationFingerprint(normalizedObservation);
	const recorded: RecordedToolOutcomeObservation = {
		...normalizedObservation,
		observationFingerprint: fingerprint,
	};
	snapshot.observations.push(recorded);
	if (snapshot.observations.length > snapshot.maxWindowObservations) snapshot.observations.shift();

	if (normalizedObservation.progress === "progress") {
		snapshot.exactRepeatStreak = 0;
		snapshot.noProgressStreak = 0;
		snapshot.lastObservationFingerprint = undefined;
	} else {
		if (fingerprint) {
			if (snapshot.lastObservationFingerprint === fingerprint) {
				snapshot.exactRepeatStreak = safeAdd(snapshot.exactRepeatStreak, 1, "exactRepeatStreak");
				snapshot.counters.exactRepeats = safeAdd(snapshot.counters.exactRepeats, 1, "exactRepeats");
			} else {
				snapshot.exactRepeatStreak = 1;
			}
			snapshot.lastObservationFingerprint = fingerprint;
		}
		if (normalizedObservation.progress === "no_progress") {
			snapshot.noProgressStreak = safeAdd(snapshot.noProgressStreak, 1, "noProgressStreak");
			snapshot.counters.noProgressObservations = safeAdd(
				snapshot.counters.noProgressObservations,
				1,
				"noProgressObservations",
			);
		}
	}
	recomputeWindowStreaks(snapshot);
	return { snapshot, decisions: evaluate(snapshot) };
}

export function recordConvergenceUsage(
	current: ConvergenceTaskSnapshot,
	entry: ConvergenceUsageEntry,
): ConvergenceTransition {
	if (!entry.usageEntryId.trim()) throw new TypeError("usageEntryId must not be empty.");
	if (!entry.source.trim()) throw new TypeError("usage source must not be empty.");
	if (current.consumedUsageEntryIds.includes(entry.usageEntryId))
		return { snapshot: cloneSnapshot(current), decisions: [] };
	const snapshot = cloneSnapshot(current);
	snapshot.consumedUsageEntryIds.push(entry.usageEntryId);
	if (!entry.usage) {
		snapshot.usageKnown = false;
		if (!snapshot.missingUsageSources.includes(entry.source)) snapshot.missingUsageSources.push(entry.source);
		return { snapshot, decisions: evaluate(snapshot) };
	}
	for (const [field, value] of Object.entries(entry.usage)) assertNonNegativeSafeInteger(value, `usage.${field}`);
	const uncachedInput = safeAdd(entry.usage.input, entry.usage.output, "usage uncached subtotal");
	const uncached = safeAdd(uncachedInput, entry.usage.cacheWrite, "usage uncached total");
	snapshot.counters.uncachedTokens = safeAdd(snapshot.counters.uncachedTokens, uncached, "uncachedTokens");
	snapshot.counters.cacheReadTokens = safeAdd(
		snapshot.counters.cacheReadTokens,
		entry.usage.cacheRead,
		"cacheReadTokens",
	);
	return { snapshot, decisions: evaluate(snapshot) };
}

export function advanceConvergenceTime(current: ConvergenceTaskSnapshot, elapsedMs: number): ConvergenceTransition {
	if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new TypeError("elapsedMs must be finite and non-negative.");
	const snapshot = cloneSnapshot(current);
	if (snapshot.state === "paused") return { snapshot, decisions: [] };
	const delta = Math.floor(elapsedMs);
	snapshot.counters.activeElapsedMs = safeAdd(snapshot.counters.activeElapsedMs, delta, "activeElapsedMs");
	snapshot.accumulatedActiveMs = safeAdd(snapshot.accumulatedActiveMs, delta, "accumulatedActiveMs");
	return { snapshot, decisions: evaluate(snapshot) };
}

function projectedResourceDecision(snapshot: ConvergenceTaskSnapshot): ConvergenceDecision | undefined {
	for (const metric of RESOURCE_METRICS) {
		const limit = snapshot.limits[metric];
		if (!limit) continue;
		const currentValue = metricValue(snapshot, metric);
		const value = metric === "toolCalls" ? safeAdd(currentValue, 1, "projected toolCalls") : currentValue;
		const exceeded = metric === "toolCalls" ? value > limit.pause : value >= limit.pause;
		if (exceeded) return decisionFor(snapshot, metric, "paused", value, limit.pause);
	}
	return undefined;
}

export function admitConvergenceEffect(
	current: ConvergenceTaskSnapshot,
	request: ConvergenceEffectRequest,
): ConvergenceEffectAdmission {
	const snapshot = cloneSnapshot(current);
	if (snapshot.state === "paused") {
		const permit = snapshot.permit;
		if (
			permit &&
			!permit.consumed &&
			permit.pauseId === snapshot.pauseId &&
			permit.effectKind === request.effectKind &&
			permit.causeSignature === snapshot.latchedDecision?.causeSignature
		) {
			permit.consumed = true;
			snapshot.counters.effectsAdmitted = safeAdd(snapshot.counters.effectsAdmitted, 1, "effectsAdmitted");
			return { kind: "admitted", snapshot, permitConsumed: true };
		}
		const decision = snapshot.latchedDecision;
		if (!decision) throw new Error("Paused convergence snapshot is missing its latched decision.");
		return { kind: "paused", snapshot, decision };
	}
	if (snapshot.state === "replan_required") {
		const decision = snapshot.pendingReplanDecision;
		if (!decision) throw new Error("Replan convergence snapshot is missing its pending decision.");
		return { kind: "replan_required", snapshot, decision };
	}

	const resourceDecision = projectedResourceDecision(snapshot);
	if (resourceDecision && snapshot.mode !== "off") {
		const decision = pause(snapshot, resourceDecision);
		return { kind: decision.kind === "paused" ? "paused" : "would_pause", snapshot, decision };
	}

	const repeatLimit = snapshot.limits.exactRepeats;
	const last = snapshot.observations.at(-1);
	if (
		request.callFingerprint &&
		repeatLimit?.replan &&
		last?.callFingerprint === request.callFingerprint &&
		snapshot.exactRepeatStreak >= repeatLimit.replan &&
		snapshot.mode !== "off"
	) {
		const candidate = decisionFor(
			snapshot,
			"exactRepeats",
			"replan_required",
			snapshot.exactRepeatStreak,
			repeatLimit.replan,
		);
		if (snapshot.escalatedCauseSignatures.includes(candidate.causeSignature)) {
			const decision = pause(snapshot, candidate);
			return { kind: decision.kind === "paused" ? "paused" : "would_pause", snapshot, decision };
		}
		if (snapshot.pendingReplanCause !== candidate.causeSignature) {
			const decision = replan(snapshot, candidate);
			return { kind: decision.kind === "replan_required" ? "replan_required" : "would_replan", snapshot, decision };
		}
	}

	snapshot.counters.effectsAdmitted = safeAdd(snapshot.counters.effectsAdmitted, 1, "effectsAdmitted");
	return { kind: "admitted", snapshot, permitConsumed: false };
}

export function completeConvergenceReplanTurn(current: ConvergenceTaskSnapshot): ConvergenceTaskSnapshot {
	const snapshot = cloneSnapshot(current);
	if (!snapshot.pendingReplanCause) return snapshot;
	if (!snapshot.escalatedCauseSignatures.includes(snapshot.pendingReplanCause)) {
		snapshot.escalatedCauseSignatures.push(snapshot.pendingReplanCause);
	}
	snapshot.pendingReplanCause = undefined;
	snapshot.pendingReplanDecision = undefined;
	if (snapshot.state === "replan_required") snapshot.state = "active";
	return snapshot;
}

export function beginConvergenceStrategyEpoch(current: ConvergenceTaskSnapshot): ConvergenceTaskSnapshot {
	if (current.state === "paused") {
		throw new TypeError("Cannot begin a strategy epoch while convergence is paused; resolve the pause explicitly.");
	}
	const snapshot = cloneSnapshot(current);
	snapshot.strategyEpoch = safeAdd(snapshot.strategyEpoch, 1, "strategyEpoch");
	snapshot.state = "active";
	snapshot.observations = [];
	snapshot.lastObservationFingerprint = undefined;
	snapshot.exactRepeatStreak = 0;
	snapshot.noProgressStreak = 0;
	snapshot.warningDedupeKeys = [];
	snapshot.escalatedCauseSignatures = [];
	snapshot.pendingReplanCause = undefined;
	snapshot.pendingReplanDecision = undefined;
	snapshot.pauseId = undefined;
	snapshot.latchedDecision = undefined;
	snapshot.permit = undefined;
	return snapshot;
}

export function updateConvergenceLimits(
	current: ConvergenceTaskSnapshot,
	patch: ConvergenceLimitsPatch,
	expectedLimitRevision: number,
): ConvergenceLimitUpdateResult {
	if (expectedLimitRevision !== current.limitRevision) {
		return { kind: "stale", expectedLimitRevision, actualLimitRevision: current.limitRevision };
	}
	const limits = cloneLimits(current.limits);
	for (const metric of ALL_METRICS) {
		if (!Object.hasOwn(patch, metric)) continue;
		const value = patch[metric];
		const profileValue = current.profileLimits[metric];
		if (value === null) {
			if (profileValue) limits[metric] = cloneLimit(profileValue);
			else delete limits[metric];
		} else if (value !== undefined) {
			limits[metric] = cloneLimit(value);
		}
	}
	validateConvergenceLimits(limits);
	const snapshot = cloneSnapshot(current);
	snapshot.limits = limits;
	snapshot.limitRevision = safeAdd(snapshot.limitRevision, 1, "limitRevision");
	return { kind: "updated", snapshot };
}

export function installConvergencePermit(
	current: ConvergenceTaskSnapshot,
	input: { permitId: string; pauseId: string; causeSignature: string; effectKind: EffectKind },
): ConvergenceTaskSnapshot {
	if (
		current.state !== "paused" ||
		current.pauseId !== input.pauseId ||
		current.latchedDecision?.causeSignature !== input.causeSignature
	) {
		throw new TypeError("Permit does not match the current pause latch.");
	}
	if (!input.permitId.trim()) throw new TypeError("Permit permitId must not be empty.");
	const snapshot = cloneSnapshot(current);
	snapshot.permit = { ...input, consumed: false };
	return snapshot;
}

export class ConvergenceController {
	#clock: MonotonicClock;
	#lastClockValue: number;
	#snapshot: ConvergenceTaskSnapshot;

	constructor(options: ConvergenceSnapshotOptions, clock: MonotonicClock = () => performance.now()) {
		this.#clock = clock;
		this.#lastClockValue = clock();
		if (!Number.isFinite(this.#lastClockValue)) throw new TypeError("Monotonic clock must return a finite number.");
		this.#snapshot = createConvergenceTaskSnapshot(options);
	}

	get snapshot(): ConvergenceTaskSnapshot {
		return cloneSnapshot(this.#snapshot);
	}

	observe(observation: ToolOutcomeObservation): ConvergenceDecision[] {
		const transition = observeToolOutcome(this.#snapshot, observation);
		this.#snapshot = transition.snapshot;
		return transition.decisions;
	}

	recordUsage(entry: ConvergenceUsageEntry): ConvergenceDecision[] {
		const transition = recordConvergenceUsage(this.#snapshot, entry);
		this.#snapshot = transition.snapshot;
		return transition.decisions;
	}

	tick(): ConvergenceDecision[] {
		const current = this.#clock();
		if (!Number.isFinite(current) || current < this.#lastClockValue) {
			throw new TypeError("Monotonic clock must be finite and must not move backwards.");
		}
		const transition = advanceConvergenceTime(this.#snapshot, current - this.#lastClockValue);
		this.#lastClockValue = current;
		this.#snapshot = transition.snapshot;
		return transition.decisions;
	}

	admit(request: ConvergenceEffectRequest): ConvergenceEffectAdmission {
		const admission = admitConvergenceEffect(this.#snapshot, request);
		this.#snapshot = admission.snapshot;
		return admission;
	}

	completeReplanTurn(): void {
		this.#snapshot = completeConvergenceReplanTurn(this.#snapshot);
	}

	beginStrategyEpoch(): void {
		this.#snapshot = beginConvergenceStrategyEpoch(this.#snapshot);
	}

	updateLimits(patch: ConvergenceLimitsPatch, expectedLimitRevision: number): ConvergenceLimitUpdateResult {
		const result = updateConvergenceLimits(this.#snapshot, patch, expectedLimitRevision);
		if (result.kind === "updated") this.#snapshot = result.snapshot;
		return result;
	}

	installPermit(input: { permitId: string; pauseId: string; causeSignature: string; effectKind: EffectKind }): void {
		this.#snapshot = installConvergencePermit(this.#snapshot, input);
	}
}
