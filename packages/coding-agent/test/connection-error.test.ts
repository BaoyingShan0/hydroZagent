import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import { isConnectionError } from "../src/core/connection-error.ts";

function errorMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
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
		stopReason: "error",
		errorMessage: text,
		timestamp: Date.now(),
	};
}

describe("isConnectionError", () => {
	it("matches connection/timeout/transport failures", () => {
		for (const text of [
			"fetch failed",
			"ETIMEDOUT",
			"socket hang up",
			"connection refused",
			"getaddrinfo ENOTFOUND",
		]) {
			expect(isConnectionError(errorMessage(text))).toBe(true);
		}
	});

	it("does not match capacity/rate-limit errors (they stay on backoff retry)", () => {
		for (const text of ["overloaded_error", "rate limit exceeded", "429 Too Many Requests", "500 internal error"]) {
			expect(isConnectionError(errorMessage(text))).toBe(false);
		}
	});

	it("is false for non-error messages", () => {
		expect(isConnectionError({ ...errorMessage("fetch failed"), stopReason: "stop" })).toBe(false);
		expect(isConnectionError({ ...errorMessage("fetch failed"), stopReason: "aborted" })).toBe(false);
	});
});
