import type { EffectKind } from "../types.ts";

export const CONVERGENCE_CONTROLLER_SCHEMA_VERSION = 1 as const;
export const CONVERGENCE_CONTROLLER_VERSION = "convergence-controller-v1" as const;
export const CONVERGENCE_CANONICALIZER_VERSION = "canonical-json-v1" as const;
export const CONVERGENCE_HASH_ALGORITHM = "sha256" as const;

export type ConvergenceMode = "off" | "observe" | "enforce";
export type ConvergenceState = "active" | "replan_required" | "paused";

export type ToolObservationKind =
	| "executed"
	| "unknown_tool"
	| "invalid_arguments"
	| "invalid_arguments_after_extension"
	| "extension_block"
	| "extension_hook_failure"
	| "guard_replan_block"
	| "guard_pause_block"
	| "sibling_not_admitted"
	| "cancelled";

export type ToolErrorClass =
	| "none"
	| "tool_execution_error"
	| "unknown_tool"
	| "invalid_arguments"
	| "invalid_arguments_after_extension"
	| "extension_hook_failure"
	| "provider_error"
	| "policy_block"
	| "guard_block"
	| "cancelled";

export type ToolProgress = "progress" | "no_progress" | "unknown";

export type ToolOutcomeObservation = {
	observationSequence: number;
	effectId?: string;
	toolCallId: string;
	toolName: string;
	kind: ToolObservationKind;
	errorClass: ToolErrorClass;
	callFingerprint?: string;
	resultFingerprint?: string;
	isErrorForModel: boolean;
	progress: ToolProgress;
};

export type ToolConvergencePolicy =
	| { mode: "normal" }
	| { mode: "bounded_poll"; maxIdenticalResults: number; minIntervalMs?: number }
	| { mode: "user_confirmed_retry" };

export type ConvergenceMetric =
	| "toolCalls"
	| "toolErrors"
	| "activeElapsedMs"
	| "uncachedTokens"
	| "noProgressObservations"
	| "exactRepeats";

export type TieredLimit = { warn?: number; replan?: number; pause: number };
export type ConvergenceLimits = Partial<Record<ConvergenceMetric, TieredLimit>>;
export type ConvergenceLimitsPatch = Partial<Record<ConvergenceMetric, TieredLimit | null>>;

export type ConvergenceCounters = {
	toolCalls: number;
	toolErrors: number;
	effectsAdmitted: number;
	activeElapsedMs: number;
	uncachedTokens: number;
	cacheReadTokens: number;
	noProgressObservations: number;
	exactRepeats: number;
};

export type RecordedToolOutcomeObservation = ToolOutcomeObservation & {
	observationFingerprint?: string;
};

export type ConvergencePermit = {
	permitId: string;
	pauseId: string;
	causeSignature: string;
	effectKind: EffectKind;
	consumed: boolean;
};

export type ConvergenceTaskSnapshot = {
	schemaVersion: typeof CONVERGENCE_CONTROLLER_SCHEMA_VERSION;
	controllerVersion: typeof CONVERGENCE_CONTROLLER_VERSION;
	canonicalizerVersion: typeof CONVERGENCE_CANONICALIZER_VERSION;
	hashAlgorithm: typeof CONVERGENCE_HASH_ALGORITHM;
	taskRunId: string;
	mode: ConvergenceMode;
	profileRevision: number;
	state: ConvergenceState;
	strategyEpoch: number;
	observationSequence: number;
	limitRevision: number;
	maxWindowObservations: number;
	profileLimits: ConvergenceLimits;
	limits: ConvergenceLimits;
	counters: ConvergenceCounters;
	accumulatedActiveMs: number;
	usageKnown: boolean;
	missingUsageSources: string[];
	consumedUsageEntryIds: string[];
	observations: RecordedToolOutcomeObservation[];
	lastObservationFingerprint?: string;
	exactRepeatStreak: number;
	noProgressStreak: number;
	warningDedupeKeys: string[];
	escalatedCauseSignatures: string[];
	pendingReplanCause?: string;
	pendingReplanDecision?: ConvergenceDecision;
	pauseId?: string;
	pauseCount: number;
	latchedDecision?: ConvergenceDecision;
	permit?: ConvergencePermit;
};

export type ConvergenceReason =
	| "exact_repeat"
	| "no_progress"
	| "tool_error_budget"
	| "tool_call_budget"
	| "active_time_budget"
	| "token_budget";

export type ConvergenceDecision = {
	kind: "warning" | "replan_required" | "paused" | "would_replan" | "would_pause";
	reason: ConvergenceReason;
	causeSignature: string;
	metric: ConvergenceMetric;
	value: number;
	limit: number;
	pauseId?: string;
};

export type ConvergenceTransition = {
	snapshot: ConvergenceTaskSnapshot;
	decisions: ConvergenceDecision[];
};

export type ConvergenceUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
};

export type ConvergenceUsageEntry = {
	usageEntryId: string;
	source: string;
	usage?: ConvergenceUsage;
};

export type ConvergenceSnapshotOptions = {
	taskRunId: string;
	mode: ConvergenceMode;
	profileRevision: number;
	limits: ConvergenceLimits;
	maxWindowObservations: number;
};

export type ConvergenceLimitUpdateResult =
	| { kind: "updated"; snapshot: ConvergenceTaskSnapshot }
	| { kind: "stale"; expectedLimitRevision: number; actualLimitRevision: number };

export type ConvergenceEffectAdmission =
	| { kind: "admitted"; snapshot: ConvergenceTaskSnapshot; permitConsumed: boolean }
	| {
			kind: "replan_required" | "paused" | "would_replan" | "would_pause";
			snapshot: ConvergenceTaskSnapshot;
			decision: ConvergenceDecision;
	  };

export type ConvergenceEffectRequest = {
	effectKind: EffectKind;
	callFingerprint?: string;
};

export type MonotonicClock = () => number;
