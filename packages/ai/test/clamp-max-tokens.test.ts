import { describe, expect, it } from "vitest";
import { clampMaxTokensToContext } from "../src/api/simple-options.ts";
import type { Api, Context, Model } from "../src/types.ts";

const emptyContext: Context = { messages: [] };

// clampMaxTokensToContext only reads model.contextWindow; a partial cast keeps the test focused.
function modelWith(contextWindow: number): Model<Api> {
	return { contextWindow } as Model<Api>;
}

describe("clampMaxTokensToContext", () => {
	it("reduces a requested maxTokens that would not fit the context window", () => {
		const result = clampMaxTokensToContext(modelWith(10_000), emptyContext, 50_000);
		expect(result).toBeLessThan(10_000);
		expect(result).toBeGreaterThan(0);
	});

	it("leaves a request that already fits unchanged", () => {
		expect(clampMaxTokensToContext(modelWith(200_000), emptyContext, 1_000)).toBe(1_000);
	});

	it("applies a conservative fallback window when contextWindow is unset or zero", () => {
		// Previously this returned the requested value unclamped (no protection);
		// now an unknown model is bounded by the 128k fallback.
		const result = clampMaxTokensToContext(modelWith(0), emptyContext, 500_000);
		expect(result).toBeLessThanOrEqual(128_000);
		expect(result).toBeGreaterThan(0);
	});

	it("treats a negative/invalid contextWindow with the same fallback", () => {
		const result = clampMaxTokensToContext(modelWith(-1), emptyContext, 500_000);
		expect(result).toBeLessThanOrEqual(128_000);
		expect(result).toBeGreaterThan(0);
	});
});
