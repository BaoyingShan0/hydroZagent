import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "../src/auth/rateLimiter.js";

describe("InMemoryRateLimiter", () => {
	it("limits within the window and exposes a stable retry delay", () => {
		const limiter = new InMemoryRateLimiter(2, 60);
		const now = new Date("2026-09-01T00:00:00.000Z");

		expect(limiter.consume("key", now)).toEqual({ allowed: true });
		expect(limiter.consume("key", now)).toEqual({ allowed: true });
		expect(limiter.consume("key", new Date(now.getTime() + 10_000))).toEqual({
			allowed: false,
			retryAfterSeconds: 50,
		});
		expect(limiter.consume("key", new Date(now.getTime() + 60_001))).toEqual({ allowed: true });
	});
});
