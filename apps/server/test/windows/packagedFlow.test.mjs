import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { generateKeyPair } from "jose";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService } from "../../src/auth/authService.js";
import { PasswordHasher } from "../../src/auth/passwordHasher.js";
import { PgAuthRepository } from "../../src/auth/pgAuthRepository.js";
import { AccessTokenService } from "../../src/auth/tokenService.js";
import { ConsentService } from "../../src/consent/consentService.js";
import { PgConsentRepository } from "../../src/consent/pgConsentRepository.js";
import { runMigrations } from "../../src/db/migrations.js";
import { parseModelCatalog } from "../../src/proxy/modelCatalog.js";
import { PgProxyCallRepository } from "../../src/proxy/pgProxyCallRepository.js";
import { ManagedProxyService } from "../../src/proxy/proxyService.js";
import { UsageKeyring } from "../../src/usage/encryption.js";
import { PgUsageRepository } from "../../src/usage/pgUsageRepository.js";
import { UsageService } from "../../src/usage/usageService.js";

const desktopRequire = createRequire(new URL("../../../desktop/package.json", import.meta.url));
const { _electron } = desktopRequire("playwright");
let pool, admin, schema, upstream, hcs, electron, page, root, usage, catalog;
let slowResponse;
const calls = [];
const pki = process.env.HCS_TEST_PKI_DIR;
const password = "fake-acceptance-password-2026";
const username = `desktop-${randomUUID().slice(0, 8)}`;
let rejectUsage = false;
let rejectedUsageAttempts = 0;

async function launch() {
	const env = {};
	for (const key of ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP"]) {
		if (process.env[key]) env[key] = process.env[key];
	}
	Object.assign(env, { HOME: root, USERPROFILE: root, APPDATA: join(root, "AppData", "Roaming"), LOCALAPPDATA: join(root, "AppData", "Local"),
		PORTABLE_EXECUTABLE_DIR: root, PI_OFFLINE: "1", PI_NO_LOCAL_LLM: "1",
		// These must have no effect on the compiled manifest.
		HYDRO_MANAGED_BUILD: "0", HYDRO_HCS_BASE_URL: "https://attacker.invalid", HYDRO_HCS_CA_BUNDLE_PATH: "missing.pem",
		PI_PATH: "C:\\forbidden-external-pi.exe" });
	electron = await _electron.launch({ executablePath: process.env.HCS_TEST_DESKTOP_EXE,
		args: [`--user-data-dir=${join(root, "data")}`], env, timeout: 45000 });
	const paths = await electron.evaluate(({ app }) => ({ packaged: app.isPackaged, userData: app.getPath("userData") }));
	expect(paths).toEqual({ packaged: true, userData: join(root, "data") });
	// Test DNS only: no host-file changes, TLS verification and application HTTPS code stay real.
	await electron.evaluate(({ Notification }) => {
		// Observe notifications in-process without placing clickable test sessions in Windows Action Center.
		Notification.prototype.show = () => {};
		const dns = process.getBuiltinModule("node:dns");
		const original = dns.lookup;
		dns.lookup = (hostname, options, callback) => {
			if (hostname !== "hcs.test.internal") return original(hostname, options, callback);
			if (typeof options === "function") return options(null, "127.0.0.1", 4);
			return options?.all ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4);
		};
	});
	page = await electron.firstWindow();
	await page.waitForFunction(() => Boolean(window.piDesktop?.managed), { timeout: 30000 });
}

beforeAll(async () => {
	// Keep ancestor discovery outside the real user's home and its resources.
	root = await mkdtemp(join(process.env.SystemRoot ?? "C:\\Windows", "Temp", "hydro-packaged-"));
	await Promise.all(["AppData/Roaming", "AppData/Local", "data"].map((directory) => mkdir(join(root, directory), { recursive: true })));
	await mkdir(join(root, "workspace"));
	await writeFile(join(root, "workspace", "fake-tool-input.txt"), "fake tool result");
	schema = `hcs_windows_${randomUUID().replaceAll("-", "")}`;
	admin = new Pool({ connectionString: process.env.HCS_TEST_DATABASE_URL });
	expect((await admin.query("SHOW server_version")).rows[0].server_version).toMatch(/^17\./);
	await admin.query(`CREATE SCHEMA ${schema}`);
	pool = new Pool({ connectionString: process.env.HCS_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
	await runMigrations(pool, "up");
	upstream = createServer(async (request, response) => {
		try {
			const buffers = [];
			for await (const chunk of request) buffers.push(chunk);
			const body = JSON.parse(Buffer.concat(buffers).toString());
			calls.push({ body, authorization: request.headers.authorization });
			response.writeHead(200, { "content-type": "text/event-stream" });
			const chunk = (delta, finish = null) => response.write(`data: ${JSON.stringify({ id: "fake-completion", object: "chat.completion.chunk",
				created: 1, model: "fake-upstream-model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
			const lastUser = [...body.messages].reverse().find((message) => message.role === "user");
			const input = JSON.stringify(lastUser?.content);
			if (input.includes("cancel-stream") || input.includes("withdraw-stream")) {
				chunk({ role: "assistant", content: "fake slow " });
				slowResponse = response;
				return;
			}
			if (input.includes("use-read-tool") && body.messages.at(-1)?.role !== "tool") {
				chunk({ role: "assistant", tool_calls: [{ index: 0, id: "fake-read-call", type: "function",
					function: { name: "read", arguments: JSON.stringify({ path: join(root, "workspace", "fake-tool-input.txt") }) } }] });
				chunk({}, "tool_calls");
			} else {
				chunk({ role: "assistant", content: "fake " });
				chunk({ content: "managed answer" });
				chunk({}, "stop");
			}
			response.end("data: [DONE]\n\n");
		} catch { response.destroy(); }
	});
	upstream.listen(0, "127.0.0.1");
	await once(upstream, "listening");
	const keys = await generateKeyPair("EdDSA");
	const auth = await createAuthService({ repository: new PgAuthRepository(pool),
		passwordHasher: new PasswordHasher({ iterations: 1, parallelism: 1, memorySizeKiB: 8192, hashLength: 32 }),
		accessTokens: new AccessTokenService({ issuer: "https://hcs.test.internal:28787", audience: "hydrozagent-managed",
			ttlSeconds: 300, privateKey: keys.privateKey, publicKey: keys.publicKey }),
		policy: { accessTtlSeconds: 300, refreshTtlSeconds: 3600, loginWindowSeconds: 60, loginAttemptsPerWindow: 30,
			registrationWindowSeconds: 60, registrationsPerWindow: 20, failedLoginThreshold: 5, lockSeconds: 60 } });
	const consent = new ConsentService({ repository: new PgConsentRepository(pool), noticeVersion: "windows-test-1", noticeText: "TEST ONLY" });
	await consent.activate(new Date());
	catalog = parseModelCatalog(JSON.stringify({ catalog_version: "windows-test-1", expires_at: new Date(Date.now() + 600000).toISOString(),
		models: [{ managed_model: { id: "managed-coder", name: "Fake acceptance model", provider: "hydro-managed",
			contextWindow: 128000, maxTokens: 8192, reasoning: false, input: ["text"] }, upstream_model: "fake-upstream-model" }] }));
	const proxy = new ManagedProxyService({ catalog, repository: new PgProxyCallRepository(pool),
		upstreamBaseUrl: `http://127.0.0.1:${upstream.address().port}/`, upstreamApiKey: "fake-server-only-key",
		requestTimeoutMilliseconds: 60000, maximumResponseBytes: 1024 * 1024, requestsPerMinute: 100, globalConcurrency: 4 });
	usage = new UsageService({ repository: new PgUsageRepository(pool), keyring: new UsageKeyring({ currentKeyId: "test-key",
		keys: new Map([["test-key", randomBytes(32)]]), fingerprintKey: randomBytes(32) }), maximumPayloadBytes: 1024 * 1024 });
	hcs = buildApp({ environment: "test", host: "127.0.0.1", port: 28787,
		https: { cert: await readFile(join(pki, "server.pem"), "utf8"), key: await readFile(join(pki, "server.key"), "utf8") } },
		{ auth, consent, proxy, usage, proxyMaximumResponseBytes: 1024 * 1024, usageMaximumPayloadBytes: 1024 * 1024, readiness: async () => [] });
	hcs.addHook("onRequest", async (request, reply) => {
		if (rejectUsage && request.url === "/ingest/usage") {
			rejectedUsageAttempts += 1;
			return reply.code(503).send({ error: { code: "upstream_error", message: "fake outage" } });
		}
	});
	hcs.addHook("onResponse", async (request, reply) => {
		console.log(`HCS ${request.method} ${request.routeOptions.url} ${reply.statusCode}`);
	});
	hcs.addHook("onError", async (_request, _reply, error) => {
		console.log("HCS failure", error.message, error.validation);
	});
	await hcs.listen({ host: "127.0.0.1", port: 28787 });
	await launch();
});

afterAll(async () => {
	await electron?.close();
	slowResponse?.destroy();
	await hcs?.close();
	upstream?.closeAllConnections();
	if (upstream?.listening) await new Promise((resolve) => upstream.close(resolve));
	await pool?.end();
	if (admin) { if (schema) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
	if (root) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

it("packaged app locks admission, runs bundled Pi through HTTPS, and links encrypted normal/tool/temporary/cancelled turns", async () => {
	const status = await page.evaluate(() => window.piDesktop.managed.status());
	expect(status).toMatchObject({ managed: true, authenticated: false });
	const deniedModels = await page.evaluate(() => window.piDesktop.projects.listModelsReport(undefined, true));
	expect(deniedModels.models).toEqual([]);
	expect(calls).toHaveLength(0);
	await page.evaluate(({ username, password }) => window.piDesktop.managed.register({ username, password }), { username, password });
	expect(await page.evaluate(() => window.piDesktop.managed.status())).toMatchObject({ consent: "required" });
	await page.evaluate(() => window.piDesktop.managed.consent({ noticeVersion: "windows-test-1" }));
	const models = await page.evaluate(() => window.piDesktop.projects.listModelsReport(undefined, true));
	expect(models.models.map((model) => model.provider)).toEqual(["hydro-managed"]);
	await expect(page.evaluate(() => window.piDesktop.pi.checkCustom("C:\\forbidden-external-pi.exe"))).rejects.toThrow("受管制品已禁用该功能");
	await expect(page.evaluate(() => window.piDesktop.settings.update({ customPiPath: "C:\\forbidden-external-pi.exe", defaultAgentBackend: "dsh" })))
		.rejects.toThrow("受管制品不允许修改运行时、网络或外部模型通道设置");
	const settings = await page.evaluate(() => window.piDesktop.settings.get());
	expect(settings.customPiPath).not.toBe("C:\\forbidden-external-pi.exe");
	expect(settings.defaultAgentBackend).not.toBe("dsh");
	await expect(page.evaluate(() => window.piDesktop.sessions.listDshModels())).rejects.toThrow("受管制品已禁用该功能");
	const project = await page.evaluate((directory) => window.piDesktop.projects.setChatPath(directory), join(root, "workspace"));
	expect(project.id).toBeTruthy();
	const draft = await page.evaluate((projectId) => window.piDesktop.sessions.createDraft({ projectId,
		model: { provider: "hydro-managed", modelId: "managed-coder" }, thinkingLevel: "off" }), project.id);
	const prompt = async (sessionId, message) => page.evaluate((input) => window.piDesktop.sessions.sendPrompt(input),
		{ sessionId, message, requestId: randomUUID() });
	const waitRecords = async (count) => expect.poll(async () => (await pool.query("SELECT count(*)::int AS count FROM usage_records")).rows[0].count,
		{ timeout: 30000, interval: 200 }).toBe(count);
	const firstPrompt = await prompt(draft.sessionId ?? draft.id, "fake-normal-stream");
	expect(firstPrompt, JSON.stringify(firstPrompt)).toMatchObject({ accepted: true });
	await waitRecords(1);
	expect(await prompt(draft.sessionId ?? draft.id, "use-read-tool")).toMatchObject({ accepted: true });
	await waitRecords(2);
	const temporary = await page.evaluate((projectId) => window.piDesktop.sessions.createAnonymous({ projectId,
		model: { provider: "hydro-managed", modelId: "managed-coder" }, thinkingLevel: "off" }), project.id);
	const temporaryId = temporary.session.sessionId ?? temporary.session.id;
	await expect.poll(() => page.evaluate((sessionId) => window.piDesktop.sessions.listRuntimes().then((runtimes) =>
		runtimes.find((runtime) => runtime.sessionId === sessionId)?.status), temporaryId), { timeout: 15000 }).toBe("idle");
	const temporaryPrompt = await prompt(temporaryId, "fake-temporary-stream");
	expect(temporaryPrompt, JSON.stringify(temporaryPrompt)).toMatchObject({ accepted: true });
	await waitRecords(3);
	const cancelled = await prompt(temporaryId, "cancel-stream");
	expect(cancelled).toMatchObject({ accepted: true });
	await expect.poll(() => Boolean(slowResponse), { timeout: 15000 }).toBe(true);
	const aborted = await page.evaluate((target) => window.piDesktop.sessions.abortRuntime(target), { sessionId: temporaryId,
		agentId: cancelled.agentId, runtimeGeneration: cancelled.runtimeGeneration });
	expect(aborted, JSON.stringify({ cancelled, aborted })).toMatchObject({ ok: true });
	await waitRecords(4);
	const records = (await pool.query(`SELECT r.*, count(l.model_call_id)::int AS links FROM usage_records r
		LEFT JOIN turn_model_call_links l ON l.usage_event_id = r.event_id GROUP BY r.event_id ORDER BY r.received_at`)).rows;
	expect(records.map((record) => record.links)).toEqual([1, 2, 1, 1]);
	expect(records[3].turn_status).toBe("aborted");
	expect(records.slice(2).every((record) => record.anonymous)).toBe(true);
	for (const record of records) {
		expect(record.user_input.toString()).not.toContain("fake-");
		expect(record.group_snapshot).toBeNull();
		expect(usage.decrypt(record.user_input, record.event_id, record.user_id, "user_input")).toBeTruthy();
	}
	expect(calls.every((call) => call.authorization === "Bearer fake-server-only-key" && call.body.model === "fake-upstream-model")).toBe(true);
	expect(calls.some((call) => call.body.messages.some((message) => message.role === "tool"))).toBe(true);
	await page.evaluate(() => window.piDesktop.managed.withdraw());
	expect(await page.evaluate(() => window.piDesktop.managed.status())).toMatchObject({ consent: "required" });
	await expect.poll(async () => (await page.evaluate(() => window.piDesktop.sessions.listRuntimes())).length).toBe(0);
	const afterWithdraw = await prompt(draft.sessionId ?? draft.id, "must-not-reach-model");
	expect(afterWithdraw.accepted).toBe(false);
	await page.evaluate(() => window.piDesktop.managed.consent({ noticeVersion: "windows-test-1" }));
	await electron.evaluate(({ Notification }) => {
		globalThis.acceptanceNotifications = 0;
		Notification.prototype.show = function () {
			if (["使用记录上报失败", "Usage record upload failed"].includes(this.title)) globalThis.acceptanceNotifications += 1;
		};
	});
	rejectUsage = true;
	expect(await prompt(draft.sessionId ?? draft.id, "fake-report-outage")).toMatchObject({ accepted: true });
	await expect.poll(() => rejectedUsageAttempts, { timeout: 20000 }).toBe(4);
	await expect.poll(() => electron.evaluate(() => globalThis.acceptanceNotifications), { timeout: 5000 }).toBe(1);
	rejectUsage = false;
	await electron.close();
	electron = undefined;
	catalog.expiresAt.setTime(Date.now() - 1000);
	await launch();
	await page.evaluate(({ username, password }) => window.piDesktop.managed.login({ username, password }), { username, password });
	await page.evaluate((projectId) => window.piDesktop.sessions.listCatalog(projectId, { scan: true }), project.id);
	await new Promise((resolve) => setTimeout(resolve, 1000));
	await waitRecords(4); // Restart/history scan must not replay either history or the lost in-memory event.
	const callCount = calls.length;
	expect((await page.evaluate(() => window.piDesktop.projects.listModelsReport(undefined, true))).models).toEqual([]);
	expect((await prompt(draft.sessionId ?? draft.id, "expired-catalog-denied")).accepted).toBe(false);
	expect(calls).toHaveLength(callCount);
	catalog.expiresAt.setTime(Date.now() + 600000);
	// Present an invalid server identity and close existing TLS connections.
	hcs.server.setSecureContext({ cert: await readFile(join(pki, "ca.pem")), key: await readFile(join(pki, "ca.key")) });
	hcs.server.closeAllConnections();
	await expect(page.evaluate(() => window.piDesktop.managed.notice())).rejects.toThrow();
	expect((await prompt(draft.sessionId ?? draft.id, "invalid-certificate-denied")).accepted).toBe(false);
	expect(calls).toHaveLength(callCount);
	hcs.server.setSecureContext({ cert: await readFile(join(pki, "server.pem")), key: await readFile(join(pki, "server.key")) });
	hcs.server.closeAllConnections();
	await page.evaluate(({ username, password }) => window.piDesktop.managed.login({ username, password }), { username, password });
	expect((await page.evaluate(() => window.piDesktop.projects.listModelsReport(undefined, true))).models).toHaveLength(1);
	// Exercise active withdrawal after the fixed-record history assertion: its final
	// aborted event may race credential revocation and must not define that baseline.
	slowResponse = undefined;
	const activeDraft = await page.evaluate((projectId) => window.piDesktop.sessions.createDraft({ projectId,
		model: { provider: "hydro-managed", modelId: "managed-coder" }, thinkingLevel: "off" }), project.id);
	const activePrompt = await prompt(activeDraft.sessionId ?? activeDraft.id, "withdraw-stream");
	expect(activePrompt, JSON.stringify(activePrompt)).toMatchObject({ accepted: true });
	await expect.poll(() => Boolean(slowResponse), { timeout: 15000 }).toBe(true);
	await page.evaluate(() => window.piDesktop.managed.withdraw());
	await expect.poll(() => slowResponse.destroyed, { timeout: 5000 }).toBe(true);
	await expect.poll(async () => (await page.evaluate(() => window.piDesktop.sessions.listRuntimes())).length).toBe(0);
	expect(await page.evaluate(() => window.piDesktop.managed.status())).toMatchObject({ consent: "required" });
	await page.evaluate(() => window.piDesktop.managed.logout());
	expect(await page.evaluate(() => window.piDesktop.managed.status())).toMatchObject({ authenticated: false });
	expect(await readdir(join(root, "data", "managed"))).not.toContain("credentials.enc");
});
