import type { ToolErrorClass, ToolObservationKind, ToolProgress } from "./types.ts";

export type ToolProgressClassifierInput = {
	toolName: string;
	kind: ToolObservationKind;
	errorClass: ToolErrorClass;
	callFingerprint?: string;
	resultFingerprint?: string;
	previousCallFingerprint?: string;
	previousResultFingerprint?: string;
};

export type ToolProgressClassifier = (input: ToolProgressClassifierInput) => ToolProgress;

/** Explicit registry for trusted adapters. Unregistered tools remain semantically unknown. */
export class ConvergenceClassifierRegistry {
	#classifiers = new Map<string, ToolProgressClassifier>();

	register(toolName: string, classifier: ToolProgressClassifier): () => void {
		const key = toolName.trim();
		if (!key) throw new TypeError("toolName must not be empty.");
		if (this.#classifiers.has(key)) throw new TypeError(`A convergence classifier is already registered for ${key}.`);
		this.#classifiers.set(key, classifier);
		return () => {
			if (this.#classifiers.get(key) === classifier) this.#classifiers.delete(key);
		};
	}

	classify(input: ToolProgressClassifierInput): ToolProgress {
		return this.#classifiers.get(input.toolName)?.(input) ?? "unknown";
	}
}
