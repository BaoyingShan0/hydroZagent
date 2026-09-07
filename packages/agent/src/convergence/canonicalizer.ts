import { Sha256 } from "@aws-crypto/sha256-js";
import {
	CONVERGENCE_CANONICALIZER_VERSION,
	CONVERGENCE_CONTROLLER_SCHEMA_VERSION,
	CONVERGENCE_HASH_ALGORITHM,
	type ToolErrorClass,
	type ToolObservationKind,
} from "./types.ts";

type CanonicalJsonValue =
	| null
	| boolean
	| number
	| string
	| CanonicalJsonValue[]
	| { [key: string]: CanonicalJsonValue };

function canonicalize(value: unknown, ancestors: WeakSet<object>): CanonicalJsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError("Canonical JSON accepts only finite numbers.");
		return Object.is(value, -0) ? 0 : value;
	}
	if (typeof value !== "object") throw new TypeError("Value is not JSON-serializable.");
	if (ancestors.has(value)) throw new TypeError("Canonical JSON does not accept circular references.");

	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			const output: CanonicalJsonValue[] = [];
			for (let index = 0; index < value.length; index += 1) {
				if (!Object.hasOwn(value, index)) throw new TypeError("Canonical JSON does not accept sparse arrays.");
				output.push(canonicalize(value[index], ancestors));
			}
			return output;
		}

		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new TypeError("Canonical JSON accepts only plain objects and arrays.");
		}
		if (Object.getOwnPropertySymbols(value).length > 0) {
			throw new TypeError("Canonical JSON does not accept symbol keys.");
		}
		const output: { [key: string]: CanonicalJsonValue } = {};
		for (const key of Object.keys(value).sort()) {
			output[key] = canonicalize(Reflect.get(value, key), ancestors);
		}
		return output;
	} finally {
		ancestors.delete(value);
	}
}

export function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalize(value, new WeakSet()));
}

export function convergenceHash(value: string): string {
	const hash = new Sha256();
	hash.update(value);
	const hex = Array.from(hash.digestSync(), (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${CONVERGENCE_HASH_ALGORITHM}:${hex}`;
}

export function hashCanonicalJson(value: unknown): string {
	return convergenceHash(canonicalJson(value));
}

export function createCallFingerprint(toolName: string, effectiveArgs: unknown): string {
	return hashCanonicalJson({ toolName, effectiveArgs });
}

export function createResultFingerprint(
	kind: ToolObservationKind,
	errorClass: ToolErrorClass,
	finalResult: unknown,
): string {
	return hashCanonicalJson({ kind, errorClass, finalResult });
}

export function createObservationFingerprint(callFingerprint: string, resultFingerprint: string): string {
	return hashCanonicalJson({ callFingerprint, resultFingerprint });
}

export function createCauseSignature(input: {
	reason: string;
	scope: string;
	detectorKey: string;
	strategyEpoch: number;
	limitRevision: number;
}): string {
	return hashCanonicalJson({
		controllerSchemaVersion: CONVERGENCE_CONTROLLER_SCHEMA_VERSION,
		canonicalizerVersion: CONVERGENCE_CANONICALIZER_VERSION,
		...input,
	});
}
