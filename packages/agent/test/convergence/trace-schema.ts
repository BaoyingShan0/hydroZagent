export const TRACE_SCHEMA_VERSION = 1 as const;
export const TRACE_CONTROLLER_VERSION = "convergence-controller-v1" as const;
export const TRACE_CANONICALIZER_VERSION = "canonical-json-v1" as const;
export const TRACE_HASH_ALGORITHM = "sha256" as const;

export type TraceUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
};

export type ToolOutcomeTraceObservation = {
	sequence: number;
	sourceSequence?: number;
	relativeMs: number;
	kind: "tool_outcome";
	toolName: string;
	callHash: string;
	outcome: "success" | "tool_error";
	errorClass?: "tool_error";
	resultHash: string;
	usage: TraceUsage;
};

export type TraceExpectation =
	| {
			type: "decision";
			level: "warning" | "replan" | "pause";
			reason:
				| "exact_repeat"
				| "no_progress"
				| "tool_error_budget"
				| "tool_call_budget"
				| "active_time_budget"
				| "token_budget";
			atOrBeforeSequence: number;
	  }
	| {
			type: "no_pause_before";
			sequence: number;
	  };

export type ConvergenceTraceCase = {
	schemaVersion: typeof TRACE_SCHEMA_VERSION;
	controllerVersion: typeof TRACE_CONTROLLER_VERSION;
	canonicalizerVersion: typeof TRACE_CANONICALIZER_VERSION;
	hashAlgorithm: typeof TRACE_HASH_ALGORITHM;
	id: string;
	description: string;
	sourceKind: "sanitized_session" | "synthetic_negative";
	observations: ToolOutcomeTraceObservation[];
	expectations: TraceExpectation[];
};

export type TraceManifestCase = {
	id: string;
	file: string;
};

export type ConvergenceTraceManifest = {
	schemaVersion: typeof TRACE_SCHEMA_VERSION;
	controllerVersion: typeof TRACE_CONTROLLER_VERSION;
	canonicalizerVersion: typeof TRACE_CANONICALIZER_VERSION;
	hashAlgorithm: typeof TRACE_HASH_ALGORITHM;
	cases: TraceManifestCase[];
};

export type LoadedConvergenceTraces = {
	manifest: ConvergenceTraceManifest;
	cases: ConvergenceTraceCase[];
};
