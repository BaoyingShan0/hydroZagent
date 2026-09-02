import { randomUUID } from "node:crypto";
import { generateKeyPair } from "jose";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminService } from "../../src/admin-cli/adminService.js";
import { PgAdminRepository } from "../../src/admin-cli/pgAdminRepository.js";
import { createAuthService, type AuthService } from "../../src/auth/authService.js";
import { PasswordHasher } from "../../src/auth/passwordHasher.js";
import { PgAuthRepository } from "../../src/auth/pgAuthRepository.js";
import { AccessTokenService } from "../../src/auth/tokenService.js";
import type { AuthPolicy } from "../../src/auth/types.js";
import { ConsentService } from "../../src/consent/consentService.js";
import { PgConsentRepository } from "../../src/consent/pgConsentRepository.js";
import { runMigrations } from "../../src/db/migrations.js";

const databaseUrl = process.env.HCS_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const NOW = new Date("2026-09-01T00:00:00.000Z");
const POLICY: AuthPolicy = {
	accessTtlSeconds: 300,
	refreshTtlSeconds: 3600,
	loginWindowSeconds: 60,
	loginAttemptsPerWindow: 20,
	registrationWindowSeconds: 60,
	registrationsPerWindow: 10,
	failedLoginThreshold: 2,
	lockSeconds: 120,
};

describeWithDatabase("P0 auth with PostgreSQL", () => {
	let adminPool: Pool;
	let pool: Pool;
	let schema: string;
	let auth: AuthService;
	let admin: AdminService;

	beforeAll(async () => {
		if (!databaseUrl) throw new Error("HCS_TEST_DATABASE_URL is required");
		schema = `hcs_auth_${randomUUID().replaceAll("-", "")}`;
		adminPool = new Pool({ connectionString: databaseUrl });
		await adminPool.query(`CREATE SCHEMA ${schema}`);
		pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
		await runMigrations(pool, "up");
		const passwordHasher = new PasswordHasher({ iterations: 1, parallelism: 1, memorySizeKiB: 8192, hashLength: 32 });
		const keys = await generateKeyPair("EdDSA");
		auth = await createAuthService({
			repository: new PgAuthRepository(pool),
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
		admin = new AdminService({ repository: new PgAdminRepository(pool), passwordHasher, resetTtlSeconds: 600 });
	});

	afterAll(async () => {
		await pool?.end();
		if (adminPool && schema) {
			await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
			await adminPool.end();
		}
	});

	it("rotates refresh, enforces real-time revocation and role changes, and preserves reset audit linkage", async () => {
		await admin.seedFirstAdmin("admin", "correct-horse-battery-staple", { type: "system" }, NOW);
		const registered = await auth.register(
			{
				username: "alice",
				password: "correct-horse-battery-staple",
				device_id: "device-01",
				client_version: "0.1.0-hydro",
			},
			{ ip: "192.0.2.10", now: NOW },
		);
		const rotated = await auth.refresh({ refresh_token: registered.refresh_token }, new Date(NOW.getTime() + 1000));
		await expect(auth.refresh({ refresh_token: registered.refresh_token }, new Date(NOW.getTime() + 2000))).rejects.toMatchObject({
			code: "unauthorized",
		});

		await admin.setRole("alice", "admin", { type: "os_operator", principal: "uid:1001" }, new Date(NOW.getTime() + 2000));
		expect(await auth.authenticateAccess(rotated.access_token, new Date(NOW.getTime() + 2001))).toMatchObject({ role: "admin" });

		const resetToken = await admin.issuePasswordReset(
			"alice",
			{ type: "os_operator", principal: "uid:1001" },
			new Date(NOW.getTime() + 3000),
		);
		await auth.confirmPasswordReset(
			{ reset_token: resetToken, new_password: "new-correct-horse-battery" },
			new Date(NOW.getTime() + 4000),
		);
		await expect(auth.authenticateAccess(rotated.access_token, new Date(NOW.getTime() + 4001))).rejects.toMatchObject({
			code: "unauthorized",
		});

		const audit = await pool.query<{ actor_type: string; actor_principal: string; issued_by_audit_id: string }>(
			`SELECT audit.actor_type, audit.actor_principal, reset.issued_by_audit_id
			 FROM password_resets AS reset JOIN admin_audit AS audit ON audit.id = reset.issued_by_audit_id
			 WHERE reset.user_id = $1`,
			[registered.user.id],
		);
		expect(audit.rows[0]).toMatchObject({
			actor_type: "os_operator",
			actor_principal: "uid:1001",
		});
		expect(audit.rows[0]?.issued_by_audit_id).toBeTruthy();
	});

	it("persists account lock state across service requests", async () => {
		const request = {
			username: "alice",
			password: "wrong-password-value",
			device_id: "device-01",
			client_version: "0.1.0-hydro",
		};
		await expect(auth.login(request, { ip: "192.0.2.20", now: new Date(NOW.getTime() + 5000) })).rejects.toMatchObject({
			code: "unauthorized",
		});
		await expect(auth.login(request, { ip: "192.0.2.20", now: new Date(NOW.getTime() + 6000) })).rejects.toMatchObject({
			code: "account_locked",
		});
	});

	it("invalidates old notice consent and enforces withdrawal from PostgreSQL state", async () => {
		const registered = await auth.register(
			{
				username: "bob",
				password: "correct-horse-battery-staple",
				device_id: "device-02",
				client_version: "0.1.0-hydro",
			},
			{ ip: "192.0.2.30", now: new Date(NOW.getTime() + 7000) },
		);
		const repository = new PgConsentRepository(pool);
		const oldNotice = new ConsentService({ repository, noticeVersion: "notice-1", noticeText: "旧告知" });
		await oldNotice.activate(new Date(NOW.getTime() + 7100));
		await oldNotice.consent(registered.user.id, "notice-1", "0.1.0-hydro", new Date(NOW.getTime() + 7200));
		const currentNotice = new ConsentService({ repository, noticeVersion: "notice-2", noticeText: "新告知" });

		expect(await currentNotice.activate(new Date(NOW.getTime() + 7300))).toBe(1);
		await expect(currentNotice.assertValidConsent(registered.user.id)).rejects.toMatchObject({ code: "consent_required" });
		await currentNotice.consent(registered.user.id, "notice-2", "0.1.0-hydro", new Date(NOW.getTime() + 7400));
		await expect(currentNotice.assertValidConsent(registered.user.id)).resolves.toBeUndefined();
		await currentNotice.withdraw(registered.user.id, new Date(NOW.getTime() + 7500));
		await expect(currentNotice.assertValidConsent(registered.user.id)).rejects.toMatchObject({ code: "consent_required" });

		const records = await pool.query<{ notice_version: string; withdrawn_at: Date | null; invalidated_at: Date | null }>(
			"SELECT notice_version, withdrawn_at, invalidated_at FROM consents WHERE user_id = $1 ORDER BY notice_version",
			[registered.user.id],
		);
		expect(records.rows).toHaveLength(2);
		expect(records.rows[0]?.invalidated_at).toBeInstanceOf(Date);
		expect(records.rows[1]?.withdrawn_at).toBeInstanceOf(Date);
	});
});
