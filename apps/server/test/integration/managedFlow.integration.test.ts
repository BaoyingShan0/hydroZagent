import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { generateKeyPair } from "jose";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService } from "../../src/auth/authService.js";
import { PasswordHasher } from "../../src/auth/passwordHasher.js";
import { PgAuthRepository } from "../../src/auth/pgAuthRepository.js";
import { AccessTokenService } from "../../src/auth/tokenService.js";
import type { AuthPolicy } from "../../src/auth/types.js";
import { ConsentService } from "../../src/consent/consentService.js";
import { PgConsentRepository } from "../../src/consent/pgConsentRepository.js";
import { runMigrations } from "../../src/db/migrations.js";
import { LifecycleService } from "../../src/lifecycle/lifecycleService.js";
import { PgLifecycleRepository } from "../../src/lifecycle/pgLifecycleRepository.js";
import { parseModelCatalog } from "../../src/proxy/modelCatalog.js";
import { PgProxyCallRepository } from "../../src/proxy/pgProxyCallRepository.js";
import { ManagedProxyService } from "../../src/proxy/proxyService.js";
import { UsageKeyring } from "../../src/usage/encryption.js";
import { PgUsageRepository } from "../../src/usage/pgUsageRepository.js";
import { UsageService } from "../../src/usage/usageService.js";

const databaseUrl = process.env.HCS_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const POLICY: AuthPolicy = {
	accessTtlSeconds: 300,
	refreshTtlSeconds: 3600,
	loginWindowSeconds: 60,
	loginAttemptsPerWindow: 20,
	registrationWindowSeconds: 60,
	registrationsPerWindow: 10,
	failedLoginThreshold: 5,
	lockSeconds: 60,
};

async function requestBody(request: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return Buffer.concat(chunks).toString("utf8");
}

describeWithDatabase("managed P0 route flow with PostgreSQL and fake upstream", () => {
	let adminPool: Pool;
	let pool: Pool;
	let schema: string;
	let upstream: Server;
	let upstreamBaseUrl: string;
	let app: ReturnType<typeof buildApp>;
	let usage: UsageService;
	const upstreamRequests: Array<{ authorization?: string; model?: string }> = [];

	beforeAll(async () => {
		if (!databaseUrl) throw new Error("HCS_TEST_DATABASE_URL is required");
		schema = `hcs_flow_${randomUUID().replaceAll("-", "")}`;
		adminPool = new Pool({ connectionString: databaseUrl });
		await adminPool.query(`CREATE SCHEMA ${schema}`);
		pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
		await runMigrations(pool, "up");

		upstream = createServer((request: IncomingMessage, response: ServerResponse) => {
			void requestBody(request).then((body) => {
				const parsed: unknown = JSON.parse(body);
				const model = typeof parsed === "object" && parsed !== null && "model" in parsed && typeof parsed.model === "string"
					? parsed.model
					: undefined;
				upstreamRequests.push({ authorization: request.headers.authorization, model });
				response.writeHead(200, { "content-type": "application/json" });
				response.end('{"choices":[{"message":{"content":"managed answer"}}],"usage":{"prompt_tokens":4,"completion_tokens":2}}');
			});
		});
		upstream.listen(0, "127.0.0.1");
		await once(upstream, "listening");
		const address = upstream.address();
		if (!address || typeof address === "string") throw new Error("Fake upstream did not bind IPv4");
		upstreamBaseUrl = `http://127.0.0.1:${address.port}/`;

		const passwordHasher = new PasswordHasher({ iterations: 1, parallelism: 1, memorySizeKiB: 8192, hashLength: 32 });
		const keys = await generateKeyPair("EdDSA");
		const auth = await createAuthService({
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
		const consent = new ConsentService({
			repository: new PgConsentRepository(pool),
			noticeVersion: "notice-1",
			noticeText: "测试环境使用与采集告知",
		});
		await consent.activate(new Date());
		const catalog = parseModelCatalog(JSON.stringify({
			catalog_version: "catalog-1",
			expires_at: "2099-01-01T00:00:00.000Z",
			models: [{
				managed_model: {
					id: "managed-coder",
					name: "Managed Coder",
					provider: "hydro-managed",
					contextWindow: 128000,
					maxTokens: 8192,
					reasoning: true,
					input: ["text"],
					defaultThinkingLevel: "medium",
				},
				upstream_model: "private/model-v1",
			}],
		}));
		const proxy = new ManagedProxyService({
			catalog,
			repository: new PgProxyCallRepository(pool),
			upstreamBaseUrl,
			upstreamApiKey: "server-only-upstream-secret",
			requestTimeoutMilliseconds: 5000,
			maximumResponseBytes: 64 * 1024,
			requestsPerMinute: 100,
			globalConcurrency: 4,
		});
		usage = new UsageService({
			repository: new PgUsageRepository(pool),
			keyring: new UsageKeyring({
				currentKeyId: "usage-key-1",
				keys: new Map([["usage-key-1", randomBytes(32)]]),
				fingerprintKey: randomBytes(32),
			}),
			maximumPayloadBytes: 64 * 1024,
		});
		app = buildApp(
			{ environment: "test", host: "127.0.0.1", port: 8787 },
			{
				auth,
				consent,
				proxy,
				proxyMaximumResponseBytes: 64 * 1024,
				usage,
				usageMaximumPayloadBytes: 64 * 1024,
				readiness: async () => [],
			},
		);
		await app.ready();
	});

	afterAll(async () => {
		await app?.close();
		if (upstream?.listening) {
			upstream.close();
			await once(upstream, "close");
		}
		await pool?.end();
		if (adminPool && schema) {
			await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
			await adminPool.end();
		}
	});

	it("registers, consents, proxies, links encrypted usage, withdraws, deactivates, and anonymizes", async () => {
		const username = `flow-${randomUUID().slice(0, 8)}`;
		const registered = await app.inject({
			method: "POST",
			url: "/auth/register",
			payload: {
				username,
				password: "correct-horse-battery-staple",
				device_id: "managed-test-device",
				client_version: "0.1.0-test",
			},
		});
		expect(registered.statusCode).toBe(201);
		const tokens = registered.json<{ access_token: string; user: { id: string } }>();
		const authorization = { authorization: `Bearer ${tokens.access_token}` };

		const beforeConsent = await app.inject({ method: "GET", url: "/proxy/v1/models", headers: authorization });
		expect(beforeConsent.statusCode).toBe(403);
		expect(beforeConsent.json()).toMatchObject({ error: { code: "consent_required" } });
		const notice = await app.inject({ method: "GET", url: "/auth/notice" });
		expect(notice.json()).toMatchObject({ notice_version: "notice-1" });
		const consent = await app.inject({
			method: "POST",
			url: "/auth/consent",
			headers: authorization,
			payload: { notice_version: "notice-1", client_version: "0.1.0-test" },
		});
		expect(consent.statusCode).toBe(200);
		const models = await app.inject({ method: "GET", url: "/proxy/v1/models", headers: authorization });
		expect(models.statusCode).toBe(200);
		expect(models.json()).toMatchObject({ catalog_version: "catalog-1", models: [{ id: "managed-coder" }] });

		const proxied = await app.inject({
			method: "POST",
			url: "/proxy/v1/chat/completions",
			headers: authorization,
			payload: { model: "managed-coder", messages: [{ role: "user", content: "sensitive prompt" }] },
		});
		expect(proxied.statusCode).toBe(200);
		const modelCallId = String(proxied.headers["x-hcs-model-call-id"]);
		expect(modelCallId).toMatch(/^[0-9a-f-]{36}$/u);
		expect(upstreamRequests).toEqual([{ authorization: "Bearer server-only-upstream-secret", model: "private/model-v1" }]);

		const eventId = randomUUID();
		const usagePayload = {
			event_id: eventId,
			session_id: randomUUID(),
			turn_id: randomUUID(),
			client_created_at: new Date().toISOString(),
			task_category: "Knowledge",
			model: "managed-coder",
			client_version: "0.1.0-test",
			device_id: "managed-test-device",
			turn_status: "completed",
			user_input: "sensitive prompt",
			assistant_final: "managed answer",
			anonymous: false,
			model_call_ids: [modelCallId],
		};
		const ingested = await app.inject({ method: "POST", url: "/ingest/usage", headers: authorization, payload: usagePayload });
		expect(ingested.statusCode).toBe(200);
		expect(ingested.json()).toEqual({ accepted: true, deduplicated: false });
		const duplicate = await app.inject({ method: "POST", url: "/ingest/usage", headers: authorization, payload: usagePayload });
		expect(duplicate.json()).toEqual({ accepted: true, deduplicated: true });

		const stored = await pool.query<{
			user_id: string;
			group_snapshot: string | null;
			user_input: Buffer;
			assistant_final: Buffer;
			links: string;
		}>(
			`SELECT record.user_id, record.group_snapshot, record.user_input, record.assistant_final,
			        count(link.model_call_id)::text AS links
			 FROM usage_records AS record
			 LEFT JOIN turn_model_call_links AS link ON link.usage_event_id = record.event_id
			 WHERE record.event_id = $1
			 GROUP BY record.event_id`,
			[eventId],
		);
		const row = stored.rows[0];
		expect(row).toMatchObject({ user_id: tokens.user.id, group_snapshot: null, links: "1" });
		expect(row?.user_input.toString("utf8")).not.toContain("sensitive prompt");
		expect(usage.decrypt(row?.user_input ?? new Uint8Array(), eventId, tokens.user.id, "user_input")).toBe("sensitive prompt");
		expect(usage.decrypt(row?.assistant_final ?? new Uint8Array(), eventId, tokens.user.id, "assistant_final")).toBe("managed answer");

		const withdrawn = await app.inject({ method: "POST", url: "/auth/withdraw-consent", headers: authorization });
		expect(withdrawn.statusCode).toBe(200);
		expect((await app.inject({ method: "GET", url: "/proxy/v1/models", headers: authorization })).statusCode).toBe(403);
		expect((await app.inject({
			method: "POST",
			url: "/auth/consent",
			headers: authorization,
			payload: { notice_version: "notice-1", client_version: "0.1.0-test" },
		})).statusCode).toBe(200);
		expect((await app.inject({ method: "POST", url: "/auth/deactivate", headers: authorization })).statusCode).toBe(200);
		expect((await app.inject({ method: "GET", url: "/proxy/v1/models", headers: authorization })).statusCode).toBe(401);

		const lifecycle = new LifecycleService({
			repository: new PgLifecycleRepository(pool),
			backupProbe: { countUnexpiredReferences: async () => 0 },
			alertSink: { notify: async () => undefined },
			policy: {
				usageRetentionSeconds: 1,
				consentRetentionSeconds: 1,
				modelCallRetentionSeconds: 1,
				authSessionRetentionSeconds: 1,
				passwordResetRetentionSeconds: 1,
				auditRetentionSeconds: 1,
				proxyMaximumTimeoutSeconds: 1,
			},
			intervalSeconds: 60,
		});
		const counts = await lifecycle.runCleanup(new Date(Date.now() + 10_000));
		expect(counts).toMatchObject({ usageRecords: 1, anonymizedUsers: 1 });
		const anonymized = await pool.query<{ username: string; status: string; anonymized_at: Date | null }>(
			"SELECT username, status, anonymized_at FROM users WHERE id = $1",
			[tokens.user.id],
		);
		expect(anonymized.rows[0]).toMatchObject({ username: `deleted-${tokens.user.id}`, status: "disabled" });
		expect(anonymized.rows[0]?.anonymized_at).toBeInstanceOf(Date);
	});
});
