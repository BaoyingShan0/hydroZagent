import { generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthService, createAuthService } from "../src/auth/authService.js";
import { PasswordHasher } from "../src/auth/passwordHasher.js";
import { hashOpaqueToken } from "../src/auth/tokenService.js";
import { AccessTokenService } from "../src/auth/tokenService.js";
import type { AuthPolicy } from "../src/auth/types.js";
import { InMemoryAuthRepository } from "./support/inMemoryAuthRepository.js";

const NOW = new Date("2026-09-01T00:00:00.000Z");
const POLICY: AuthPolicy = {
	accessTtlSeconds: 300,
	refreshTtlSeconds: 3600,
	loginWindowSeconds: 60,
	loginAttemptsPerWindow: 10,
	registrationWindowSeconds: 60,
	registrationsPerWindow: 3,
	failedLoginThreshold: 2,
	lockSeconds: 120,
};
const passwordHasher = new PasswordHasher({ iterations: 1, parallelism: 1, memorySizeKiB: 8192, hashLength: 32 });
let accessTokens: AccessTokenService;

beforeAll(async () => {
	const keys = await generateKeyPair("EdDSA");
	accessTokens = new AccessTokenService({
		issuer: "https://hcs.test",
		audience: "hydrozagent-managed",
		ttlSeconds: POLICY.accessTtlSeconds,
		privateKey: keys.privateKey,
		publicKey: keys.publicKey,
	});
});

async function makeService(repository: InMemoryAuthRepository): Promise<AuthService> {
	return createAuthService({ repository, passwordHasher, accessTokens, policy: POLICY });
}

describe("AuthService", () => {
	it("registers a self-reported account and authenticates its access token", async () => {
		const repository = new InMemoryAuthRepository();
		const service = await makeService(repository);

		const response = await service.register(
			{
				username: " Hydro.User ",
				password: "correct-horse-battery-staple",
				device_id: "device-01",
				client_version: "0.1.0-hydro",
			},
			{ ip: "192.0.2.10", now: NOW },
		);

		expect(response.user).toMatchObject({ username: "hydro.user", role: "user", is_self_reported: true });
		expect(await service.authenticateAccess(response.access_token, NOW)).toMatchObject({
			userId: response.user.id,
			role: "user",
			username: "hydro.user",
		});
	});

	it("rejects weak and duplicate registrations with redacted audit summaries", async () => {
		const repository = new InMemoryAuthRepository();
		const service = await makeService(repository);
		const valid = {
			username: "alice",
			password: "correct-horse-battery-staple",
			device_id: "device-01",
			client_version: "0.1.0-hydro",
		};

		await expect(
			service.register({ ...valid, password: "password1234" }, { ip: "192.0.2.10", now: NOW }),
		).rejects.toMatchObject({ code: "invalid_request", statusCode: 400 });
		await service.register(valid, { ip: "192.0.2.10", now: NOW });
		await expect(service.register(valid, { ip: "192.0.2.11", now: NOW })).rejects.toMatchObject({
			code: "invalid_request",
			statusCode: 409,
		});
		expect(repository.audits.map((audit) => audit.paramsSummary)).toEqual([
			{ reason_code: "weak_password" },
			{ reason_code: "username_unavailable" },
		]);
		expect(JSON.stringify(repository.audits)).not.toContain(valid.password);
	});

	it("locks an account after repeated failed logins", async () => {
		const repository = new InMemoryAuthRepository();
		const passwordHash = await passwordHasher.hash("correct-horse-battery-staple");
		repository.seedUser({ username: "alice", passwordHash });
		const service = await makeService(repository);
		const request = {
			username: "alice",
			password: "wrong-password-value",
			device_id: "device-01",
			client_version: "0.1.0-hydro",
		};

		await expect(service.login(request, { ip: "192.0.2.10", now: NOW })).rejects.toMatchObject({ code: "unauthorized" });
		await expect(service.login(request, { ip: "192.0.2.10", now: NOW })).rejects.toMatchObject({ code: "account_locked" });
	});

	it("rotates refresh tokens and immediately rejects logout sessions", async () => {
		const repository = new InMemoryAuthRepository();
		const service = await makeService(repository);
		const registered = await service.register(
			{
				username: "alice",
				password: "correct-horse-battery-staple",
				device_id: "device-01",
				client_version: "0.1.0-hydro",
			},
			{ ip: "192.0.2.10", now: NOW },
		);
		const rotated = await service.refresh({ refresh_token: registered.refresh_token }, new Date(NOW.getTime() + 1000));

		await expect(service.refresh({ refresh_token: registered.refresh_token }, new Date(NOW.getTime() + 2000))).rejects.toMatchObject({
			code: "unauthorized",
		});
		const principal = await service.authenticateAccess(rotated.access_token, new Date(NOW.getTime() + 2000));
		await service.logout(principal, new Date(NOW.getTime() + 2000));
		await expect(service.authenticateAccess(rotated.access_token, new Date(NOW.getTime() + 2001))).rejects.toMatchObject({
			code: "unauthorized",
		});
	});

	it("password reset consumes once and revokes all existing sessions", async () => {
		const repository = new InMemoryAuthRepository();
		const service = await makeService(repository);
		const registered = await service.register(
			{
				username: "alice",
				password: "correct-horse-battery-staple",
				device_id: "device-01",
				client_version: "0.1.0-hydro",
			},
			{ ip: "192.0.2.10", now: NOW },
		);
		const resetToken = "reset-token-with-more-than-thirty-two-random-characters";
		repository.seedReset(registered.user.id, hashOpaqueToken(resetToken), new Date(NOW.getTime() + 60_000));

		await service.confirmPasswordReset({ reset_token: resetToken, new_password: "new-correct-horse-battery" }, NOW);

		await expect(service.authenticateAccess(registered.access_token, new Date(NOW.getTime() + 1))).rejects.toMatchObject({
			code: "unauthorized",
		});
		await expect(
			service.confirmPasswordReset({ reset_token: resetToken, new_password: "another-correct-password" }, NOW),
		).rejects.toMatchObject({ code: "unauthorized" });
	});
});
