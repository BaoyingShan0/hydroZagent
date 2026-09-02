import { randomUUID } from "node:crypto";
import { generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { AccessTokenService, createRefreshToken, parseRefreshToken } from "../src/auth/tokenService.js";
import type { AuthUser } from "../src/auth/types.js";

describe("token services", () => {
	it("issues a signed access token with the required claims and enforces expiration", async () => {
		const keys = await generateKeyPair("EdDSA");
		const service = new AccessTokenService({
			issuer: "https://hcs.test",
			audience: "hydrozagent-managed",
			ttlSeconds: 60,
			privateKey: keys.privateKey,
			publicKey: keys.publicKey,
		});
		const user: AuthUser = {
			id: randomUUID(),
			username: "alice",
			passwordHash: "not-used",
			role: "admin",
			status: "active",
			isSelfReported: false,
			failedLoginCount: 0,
			lockedUntil: null,
		};
		const sessionId = randomUUID();
		const now = new Date("2026-09-01T00:00:00.000Z");
		const token = await service.issue(user, sessionId, now);

		expect(await service.verify(token, new Date(now.getTime() + 59_000))).toMatchObject({
			userId: user.id,
			sessionId,
			role: "admin",
		});
		await expect(service.verify(token, new Date(now.getTime() + 61_000))).rejects.toThrow();
	});

	it("creates parseable opaque refresh tokens and rejects malformed values", () => {
		const created = createRefreshToken();

		expect(parseRefreshToken(created.token)).toEqual(created);
		expect(parseRefreshToken(`${created.token}.extra`)).toBeNull();
		expect(parseRefreshToken("not-a-refresh-token")).toBeNull();
		expect(created.token).not.toContain(created.hash);
	});
});
