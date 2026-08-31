import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
	type ConvergenceTraceCase,
	type ConvergenceTraceManifest,
	type LoadedConvergenceTraces,
	type ToolOutcomeTraceObservation,
	TRACE_CANONICALIZER_VERSION,
	TRACE_CONTROLLER_VERSION,
	TRACE_HASH_ALGORITHM,
	TRACE_SCHEMA_VERSION,
	type TraceExpectation,
	type TraceManifestCase,
	type TraceUsage,
} from "./trace-schema.ts";

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const FORBIDDEN_RAW_KEYS = new Set([
	"access_token",
	"accesstoken",
	"auth",
	"authorization",
	"apikey",
	"arguments",
	"args",
	"client_secret",
	"clientsecret",
	"content",
	"cookie",
	"cookies",
	"credential",
	"credentials",
	"cwd",
	"headers",
	"model",
	"outputtext",
	"password",
	"passwd",
	"path",
	"prompt",
	"provider",
	"rawresult",
	"refresh_token",
	"refreshtoken",
	"secret",
	"set-cookie",
	"sessioncookie",
	"token",
]);

function fail(location: string, message: string): never {
	throw new Error(`Invalid convergence trace at ${location}: ${message}`);
}

function asRecord(value: unknown, location: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		fail(location, "expected an object");
	}
	return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], location: string): void {
	const allowedKeys = new Set(allowed);
	for (const key of Object.keys(record)) {
		if (!allowedKeys.has(key)) fail(`${location}.${key}`, "unknown field is forbidden");
	}
}

function asString(value: unknown, location: string): string {
	if (typeof value !== "string" || value.length === 0) fail(location, "expected a non-empty string");
	return value;
}

function asNonNegativeInteger(value: unknown, location: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		fail(location, "expected a non-negative safe integer");
	}
	return value;
}

function assertVersion(value: unknown, expected: string | number, location: string): void {
	if (value !== expected) fail(location, `unsupported version ${String(value)}; expected ${String(expected)}`);
}

function assertNoRawFields(value: unknown, location: string): void {
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index++) assertNoRawFields(value[index], `${location}[${index}]`);
		return;
	}
	if (typeof value !== "object" || value === null) return;

	for (const [key, child] of Object.entries(value)) {
		if (FORBIDDEN_RAW_KEYS.has(key.toLowerCase())) fail(`${location}.${key}`, "raw or sensitive field is forbidden");
		assertNoRawFields(child, `${location}.${key}`);
	}
}

function parseUsage(value: unknown, location: string): TraceUsage {
	const record = asRecord(value, location);
	assertExactKeys(record, ["input", "output", "cacheRead", "cacheWrite"], location);
	return {
		input: asNonNegativeInteger(record.input, `${location}.input`),
		output: asNonNegativeInteger(record.output, `${location}.output`),
		cacheRead: asNonNegativeInteger(record.cacheRead, `${location}.cacheRead`),
		cacheWrite: asNonNegativeInteger(record.cacheWrite, `${location}.cacheWrite`),
	};
}

function parseObservation(value: unknown, location: string): ToolOutcomeTraceObservation {
	const record = asRecord(value, location);
	assertExactKeys(
		record,
		[
			"sequence",
			"sourceSequence",
			"relativeMs",
			"kind",
			"toolName",
			"callHash",
			"outcome",
			"errorClass",
			"resultHash",
			"usage",
		],
		location,
	);
	if (record.kind !== "tool_outcome") fail(`${location}.kind`, "expected tool_outcome");
	const outcome = record.outcome;
	if (outcome !== "success" && outcome !== "tool_error") fail(`${location}.outcome`, "unknown outcome");

	const callHash = asString(record.callHash, `${location}.callHash`);
	const resultHash = asString(record.resultHash, `${location}.resultHash`);
	if (!HASH_PATTERN.test(callHash)) fail(`${location}.callHash`, "expected a versioned SHA-256 hash");
	if (!HASH_PATTERN.test(resultHash)) fail(`${location}.resultHash`, "expected a versioned SHA-256 hash");

	const errorClass = record.errorClass;
	if (outcome === "tool_error" && errorClass !== "tool_error") {
		fail(`${location}.errorClass`, "tool_error outcomes require tool_error classification");
	}
	if (outcome === "success" && errorClass !== undefined) {
		fail(`${location}.errorClass`, "successful outcomes cannot carry an error class");
	}

	const sourceSequence = record.sourceSequence;
	return {
		sequence: asNonNegativeInteger(record.sequence, `${location}.sequence`),
		...(sourceSequence === undefined
			? {}
			: { sourceSequence: asNonNegativeInteger(sourceSequence, `${location}.sourceSequence`) }),
		relativeMs: asNonNegativeInteger(record.relativeMs, `${location}.relativeMs`),
		kind: "tool_outcome",
		toolName: asString(record.toolName, `${location}.toolName`),
		callHash,
		outcome,
		...(errorClass === "tool_error" ? { errorClass } : {}),
		resultHash,
		usage: parseUsage(record.usage, `${location}.usage`),
	};
}

function parseExpectation(value: unknown, location: string): TraceExpectation {
	const record = asRecord(value, location);
	if (record.type === "no_pause_before") {
		assertExactKeys(record, ["type", "sequence"], location);
		return { type: "no_pause_before", sequence: asNonNegativeInteger(record.sequence, `${location}.sequence`) };
	}
	if (record.type !== "decision") fail(`${location}.type`, "unknown expectation type");
	assertExactKeys(record, ["type", "level", "reason", "atOrBeforeSequence"], location);
	if (record.level !== "warning" && record.level !== "replan" && record.level !== "pause") {
		fail(`${location}.level`, "unknown decision level");
	}
	if (
		record.reason !== "exact_repeat" &&
		record.reason !== "no_progress" &&
		record.reason !== "tool_error_budget" &&
		record.reason !== "tool_call_budget" &&
		record.reason !== "active_time_budget" &&
		record.reason !== "token_budget"
	) {
		fail(`${location}.reason`, "unknown decision reason");
	}
	return {
		type: "decision",
		level: record.level,
		reason: record.reason,
		atOrBeforeSequence: asNonNegativeInteger(record.atOrBeforeSequence, `${location}.atOrBeforeSequence`),
	};
}

function parseManifestCase(value: unknown, location: string): TraceManifestCase {
	const record = asRecord(value, location);
	assertExactKeys(record, ["id", "file"], location);
	const id = asString(record.id, `${location}.id`);
	const file = asString(record.file, `${location}.file`);
	if (!SAFE_ID_PATTERN.test(id)) fail(`${location}.id`, "expected a lowercase kebab-case id");
	if (basename(file) !== file || !file.endsWith(".json")) fail(`${location}.file`, "expected a local JSON filename");
	return { id, file };
}

export function parseTraceManifest(value: unknown): ConvergenceTraceManifest {
	assertNoRawFields(value, "manifest");
	const record = asRecord(value, "manifest");
	assertExactKeys(
		record,
		["schemaVersion", "controllerVersion", "canonicalizerVersion", "hashAlgorithm", "cases"],
		"manifest",
	);
	assertVersion(record.schemaVersion, TRACE_SCHEMA_VERSION, "manifest.schemaVersion");
	assertVersion(record.controllerVersion, TRACE_CONTROLLER_VERSION, "manifest.controllerVersion");
	assertVersion(record.canonicalizerVersion, TRACE_CANONICALIZER_VERSION, "manifest.canonicalizerVersion");
	assertVersion(record.hashAlgorithm, TRACE_HASH_ALGORITHM, "manifest.hashAlgorithm");
	if (!Array.isArray(record.cases) || record.cases.length === 0) fail("manifest.cases", "expected at least one case");

	const cases = record.cases.map((entry, index) => parseManifestCase(entry, `manifest.cases[${index}]`));
	if (new Set(cases.map((entry) => entry.id)).size !== cases.length) fail("manifest.cases", "duplicate case id");
	if (new Set(cases.map((entry) => entry.file)).size !== cases.length) fail("manifest.cases", "duplicate case file");

	return {
		schemaVersion: TRACE_SCHEMA_VERSION,
		controllerVersion: TRACE_CONTROLLER_VERSION,
		canonicalizerVersion: TRACE_CANONICALIZER_VERSION,
		hashAlgorithm: TRACE_HASH_ALGORITHM,
		cases,
	};
}

export function parseTraceCase(value: unknown, expectedId?: string): ConvergenceTraceCase {
	assertNoRawFields(value, expectedId ?? "case");
	const record = asRecord(value, expectedId ?? "case");
	assertExactKeys(
		record,
		[
			"schemaVersion",
			"controllerVersion",
			"canonicalizerVersion",
			"hashAlgorithm",
			"id",
			"description",
			"sourceKind",
			"observations",
			"expectations",
		],
		expectedId ?? "case",
	);
	assertVersion(record.schemaVersion, TRACE_SCHEMA_VERSION, `${expectedId ?? "case"}.schemaVersion`);
	assertVersion(record.controllerVersion, TRACE_CONTROLLER_VERSION, `${expectedId ?? "case"}.controllerVersion`);
	assertVersion(
		record.canonicalizerVersion,
		TRACE_CANONICALIZER_VERSION,
		`${expectedId ?? "case"}.canonicalizerVersion`,
	);
	assertVersion(record.hashAlgorithm, TRACE_HASH_ALGORITHM, `${expectedId ?? "case"}.hashAlgorithm`);

	const id = asString(record.id, `${expectedId ?? "case"}.id`);
	if (!SAFE_ID_PATTERN.test(id)) fail(`${id}.id`, "expected a lowercase kebab-case id");
	if (expectedId !== undefined && id !== expectedId)
		fail(`${expectedId}.id`, `fixture id ${id} does not match manifest`);
	if (record.sourceKind !== "sanitized_session" && record.sourceKind !== "synthetic_negative") {
		fail(`${id}.sourceKind`, "unknown source kind");
	}
	if (!Array.isArray(record.observations) || record.observations.length === 0) {
		fail(`${id}.observations`, "expected at least one observation");
	}
	if (!Array.isArray(record.expectations) || record.expectations.length === 0) {
		fail(`${id}.expectations`, "expected at least one expectation");
	}

	const observations = record.observations.map((entry, index) =>
		parseObservation(entry, `${id}.observations[${index}]`),
	);
	let previousMs = -1;
	for (let index = 0; index < observations.length; index++) {
		const observation = observations[index];
		if (observation.sequence !== index + 1)
			fail(`${id}.observations[${index}].sequence`, "sequence must be contiguous from 1");
		if (observation.relativeMs < previousMs)
			fail(`${id}.observations[${index}].relativeMs`, "relative time must be monotonic");
		previousMs = observation.relativeMs;
	}

	return {
		schemaVersion: TRACE_SCHEMA_VERSION,
		controllerVersion: TRACE_CONTROLLER_VERSION,
		canonicalizerVersion: TRACE_CANONICALIZER_VERSION,
		hashAlgorithm: TRACE_HASH_ALGORITHM,
		id,
		description: asString(record.description, `${id}.description`),
		sourceKind: record.sourceKind,
		observations,
		expectations: record.expectations.map((entry, index) => parseExpectation(entry, `${id}.expectations[${index}]`)),
	};
}

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export function readTraceFixtureDirectory(directory: string): LoadedConvergenceTraces {
	const manifest = parseTraceManifest(readJson(join(directory, "manifest.json")));
	const cases = manifest.cases.map((entry) => parseTraceCase(readJson(join(directory, entry.file)), entry.id));
	return { manifest, cases };
}
