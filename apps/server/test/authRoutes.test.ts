import type { FastifyInstance } from "fastify";
import { generateKeyPair } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createAuthService } from "../src/auth/authService.js";
import { PasswordHasher } from "../src/auth/passwordHasher.js";
import { AccessTokenService } from "../src/auth/tokenService.js";
import type { AuthPolicy } from "../src/auth/types.js";
import { ConsentService } from "../src/consent/consentService.js";
import { InMemoryAuthRepository } from "./support/inMemoryAuthRepository.js";
import { InMemoryConsentRepository } from "./support/inMemoryConsentRepository.js";

const POLICY: AuthPolicy = {
	accessTtlSeconds: 300,
	refreshTtlSeconds: 3600,
	loginWindowSeconds: 60,
	loginAttemptsPerWindow: 10,
	registrationWindowSeconds: 60,
	registrationsPerWindow: 3,
	failedLoginThreshold: 3,
	lockSeconds: 120,
};
const openApps: FastifyInstance[] = [];

afterEach(async () => {
	await Promise.all(openApps.splice(0).map((app) => app.close()));
});

async function makeApp(): Promise<FastifyInstance> {
	const keys = await generateKeyPair("EdDSA");
	const passwordHasher = new PasswordHasher({ iterations: 1, parallelism: 1, memorySizeKiB: 8192, hashLength: 32 });
	const auth = await createAuthService({
		repository: new InMemoryAuthRepository(),
		passwordHasher,
		accessTokens: new AccessTokenService({
			issuer: "https://hcs.test",
			audience: "hydrozagent-managed",
			ttlSeconds: POLICY.accessTtlSeconds,
			privateKey: keys.privateKey,
			publicKey: keys.publicKey,
		}),
		policy: POLICY,
	});
	const consent = new ConsentService({
		repository: new InMemoryConsentRepository(),
		noticeVersion: "notice-1",
		noticeText: "将采集每轮用户输入与最终回复。",
	});
	const app = buildApp({ environment: "test", host: "127.0.0.1", port: 8787 }, { auth, consent });
	openApps.push(app);
	return app;
}

describe("P0 auth routes", () => {
	it("enforces canonical request schemas without echoing passwords", async () => {
		const app = await makeApp();
		const response = await app.inject({
			method: "POST",
			url: "/auth/register",
			payload: {
				username: "alice",
				password: "correct-horse-battery-staple",
				device_id: "device-01",
				client_version: "0.1.0-hydro",
				user_id: "forged-client-identity",
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({ error: { code: "invalid_request", message: "请求字段不符合契约" } });
		expect(response.body).not.toContain("correct-horse-battery-staple");
	});

	it("registers, rotates refresh, logs out, and rejects the revoked access token", async () => {
		const app = await makeApp();
		const registration = await app.inject({
			method: "POST",
			url: "/auth/register",
			payload: {
				username: "alice",
				password: "correct-horse-battery-staple",
				device_id: "device-01",
				client_version: "0.1.0-hydro",
			},
		});
		expect(registration.statusCode).toBe(201);
		const registered = registration.json<{
			access_token: string;
			refresh_token: string;
			user: { is_self_reported: boolean };
		}>();
		expect(registered.user.is_self_reported).toBe(true);

		const refresh = await app.inject({
			method: "POST",
			url: "/auth/refresh",
			payload: { refresh_token: registered.refresh_token },
		});
		expect(refresh.statusCode).toBe(200);
		const rotated = refresh.json<{ access_token: string; refresh_token: string }>();
		expect(rotated.refresh_token).not.toBe(registered.refresh_token);

		const logout = await app.inject({
			method: "POST",
			url: "/auth/logout",
			headers: { authorization: `Bearer ${rotated.access_token}` },
		});
		expect(logout.statusCode).toBe(200);

		const deactivate = await app.inject({
			method: "POST",
			url: "/auth/deactivate",
			headers: { authorization: `Bearer ${rotated.access_token}` },
		});
		expect(deactivate.statusCode).toBe(401);
		expect(deactivate.json()).toMatchObject({ error: { code: "unauthorized" } });
	});

	it("does not expose an administrator network route", async () => {
		const app = await makeApp();
		const response = await app.inject({ method: "GET", url: "/admin/users" });
		expect(response.statusCode).toBe(404);
	});

	it("serves the current notice and requires its exact version", async () => {
		const app = await makeApp();
		const registration = await app.inject({
			method: "POST",
			url: "/auth/register",
			payload: {
				username: "alice",
				password: "correct-horse-battery-staple",
				device_id: "device-01",
				client_version: "0.1.0-hydro",
			},
		});
		const tokens = registration.json<{ access_token: string }>();
		const notice = await app.inject({ method: "GET", url: "/auth/notice" });
		expect(notice.json()).toEqual({ notice_version: "notice-1", text: "将采集每轮用户输入与最终回复。" });

		const stale = await app.inject({
			method: "POST",
			url: "/auth/consent",
			headers: { authorization: `Bearer ${tokens.access_token}` },
			payload: { notice_version: "notice-0", client_version: "0.1.0-hydro" },
		});
		expect(stale.statusCode).toBe(403);
		expect(stale.json()).toMatchObject({ error: { code: "consent_required" } });

		const current = await app.inject({
			method: "POST",
			url: "/auth/consent",
			headers: { authorization: `Bearer ${tokens.access_token}` },
			payload: { notice_version: "notice-1", client_version: "0.1.0-hydro" },
		});
		expect(current.statusCode).toBe(200);
	});
});
