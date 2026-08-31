import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTraceCase, parseTraceManifest, readTraceFixtureDirectory } from "./trace-reader.ts";
import {
	TRACE_CANONICALIZER_VERSION,
	TRACE_CONTROLLER_VERSION,
	TRACE_HASH_ALGORITHM,
	TRACE_SCHEMA_VERSION,
} from "./trace-schema.ts";

const fixtureDirectory = fileURLToPath(new URL("../fixtures/convergence", import.meta.url));

function validObservation() {
	return {
		sequence: 1,
		relativeMs: 0,
		kind: "tool_outcome",
		toolName: "read",
		callHash: `sha256:${"a".repeat(64)}`,
		outcome: "success",
		resultHash: `sha256:${"b".repeat(64)}`,
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	};
}

function validCase() {
	return {
		schemaVersion: TRACE_SCHEMA_VERSION,
		controllerVersion: TRACE_CONTROLLER_VERSION,
		canonicalizerVersion: TRACE_CANONICALIZER_VERSION,
		hashAlgorithm: TRACE_HASH_ALGORITHM,
		id: "valid-case",
		description: "Sanitized fixture",
		sourceKind: "synthetic_negative",
		observations: [validObservation()],
		expectations: [{ type: "no_pause_before", sequence: 1 }],
	};
}

describe("convergence trace reader", () => {
	it("loads versioned incident and negative fixtures deterministically", () => {
		const first = readTraceFixtureDirectory(fixtureDirectory);
		const second = readTraceFixtureDirectory(fixtureDirectory);

		expect(second).toEqual(first);
		expect(first.manifest.cases).toHaveLength(7);
		expect(first.cases.map((entry) => entry.id)).toEqual(first.manifest.cases.map((entry) => entry.id));

		const incident = first.cases.find((entry) => entry.id === "incident-repeated-failing-search");
		expect(incident?.sourceKind).toBe("sanitized_session");
		expect(incident?.observations).toHaveLength(31);

		const repeated = incident?.observations.slice(5, 28) ?? [];
		expect(repeated).toHaveLength(23);
		expect(new Set(repeated.map((entry) => entry.callHash))).toHaveLength(1);
		expect(new Set(repeated.map((entry) => entry.resultHash))).toHaveLength(1);
		expect(repeated.every((entry) => entry.outcome === "tool_error")).toBe(true);
	});

	it("keeps every negative control explicitly non-pausing within its declared bound", () => {
		const loaded = readTraceFixtureDirectory(fixtureDirectory);
		const negativeCases = loaded.cases.filter((entry) => entry.sourceKind === "synthetic_negative");

		expect(negativeCases).toHaveLength(6);
		for (const traceCase of negativeCases) {
			expect(traceCase.expectations).toContainEqual({
				type: "no_pause_before",
				sequence: traceCase.observations.length,
			});
		}
	});

	it("rejects unknown schema versions", () => {
		expect(() =>
			parseTraceManifest({
				schemaVersion: 2,
				controllerVersion: TRACE_CONTROLLER_VERSION,
				canonicalizerVersion: TRACE_CANONICALIZER_VERSION,
				hashAlgorithm: TRACE_HASH_ALGORITHM,
				cases: [{ id: "case", file: "case.json" }],
			}),
		).toThrow(/unsupported version 2/);
	});

	it("rejects raw or sensitive fields anywhere in a fixture", () => {
		const fixture = validCase();
		expect(() => parseTraceCase({ ...fixture, prompt: "secret" })).toThrow(/raw or sensitive field is forbidden/);
		expect(() =>
			parseTraceCase({
				...fixture,
				observations: [{ ...validObservation(), arguments: { query: "secret" } }],
			}),
		).toThrow(/raw or sensitive field is forbidden/);
		for (const key of ["authorization", "token", "secret", "password", "cookie"] as const) {
			expect(() => parseTraceCase({ ...fixture, [key]: "sensitive" })).toThrow(
				/raw or sensitive field is forbidden/,
			);
		}
	});

	it("rejects unknown fields instead of silently discarding them", () => {
		const fixture = validCase();
		expect(() => parseTraceCase({ ...fixture, unexpectedMetadata: true })).toThrow(/unknown field is forbidden/);
		expect(() =>
			parseTraceCase({
				...fixture,
				observations: [{ ...validObservation(), extra: "discarded-before" }],
			}),
		).toThrow(/unknown field is forbidden/);
	});

	it("rejects traversal filenames and malformed hashes", () => {
		expect(() =>
			parseTraceManifest({
				schemaVersion: TRACE_SCHEMA_VERSION,
				controllerVersion: TRACE_CONTROLLER_VERSION,
				canonicalizerVersion: TRACE_CANONICALIZER_VERSION,
				hashAlgorithm: TRACE_HASH_ALGORITHM,
				cases: [{ id: "case", file: "../case.json" }],
			}),
		).toThrow(/local JSON filename/);

		const fixture = validCase();
		expect(() =>
			parseTraceCase({
				...fixture,
				observations: [{ ...validObservation(), callHash: "not-a-hash" }],
			}),
		).toThrow(/versioned SHA-256 hash/);
	});
});
