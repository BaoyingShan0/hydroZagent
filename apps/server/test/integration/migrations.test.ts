import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrations.js";

const databaseUrl = process.env.HCS_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("P0 PostgreSQL migrations", () => {
	let adminPool: Pool;
	let pool: Pool;
	let schema: string;

	beforeAll(async () => {
		if (!databaseUrl) throw new Error("HCS_TEST_DATABASE_URL is required");
		schema = `hcs_test_${randomUUID().replaceAll("-", "")}`;
		adminPool = new Pool({ connectionString: databaseUrl });
		await adminPool.query(`CREATE SCHEMA ${schema}`);
		pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
	});

	afterAll(async () => {
		await pool?.end();
		if (adminPool && schema) {
			await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
			await adminPool.end();
		}
	});

	it("migrates up idempotently, enforces constraints, cascades only links, then migrates down and up", async () => {
		const firstUp = await runMigrations(pool, "up");
		expect(firstUp).toEqual(["0001_p0_schema.sql"]);
		expect(await runMigrations(pool, "up")).toEqual([]);

		const expectedTables = [
			"admin_audit",
			"auth_sessions",
			"consents",
			"model_proxy_calls",
			"password_resets",
			"schema_migrations",
			"turn_model_call_links",
			"usage_records",
			"users",
		];
		const tableResult = await pool.query<{ table_name: string }>(
			"SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
			[schema],
		);
		expect(tableResult.rows.map((row) => row.table_name)).toEqual(expectedTables);

		const userId = randomUUID();
		const auditId = randomUUID();
		const resetId = randomUUID();
		const callId = randomUUID();
		const eventId = randomUUID();
		await pool.query(
			"INSERT INTO users(id, username, password_hash) VALUES ($1, $2, $3)",
			[userId, "migration-user", "argon2id-tombstone"],
		);
		await pool.query(
			"INSERT INTO admin_audit(id, actor_type, action, target_type) VALUES ($1, 'system', 'seed', 'user')",
			[auditId],
		);
		await pool.query(
			"INSERT INTO password_resets(id, user_id, token_hash, expires_at, issued_by_audit_id) VALUES ($1, $2, $3, now() + interval '1 hour', $4)",
			[resetId, userId, "reset-hash", auditId],
		);
		await pool.query("INSERT INTO model_proxy_calls(id, user_id, model) VALUES ($1, $2, $3)", [
			callId,
			userId,
			"hydro-chat",
		]);
		await pool.query(
			"INSERT INTO usage_records(event_id, session_id, turn_id, user_id, turn_status, user_input, payload_fingerprint) VALUES ($1, $2, $3, $4, 'completed', $5, $6)",
			[eventId, randomUUID(), randomUUID(), userId, Buffer.from("encrypted"), "test-fingerprint-1"],
		);
		await pool.query("INSERT INTO turn_model_call_links(usage_event_id, model_call_id) VALUES ($1, $2)", [eventId, callId]);

		await pool.query("DELETE FROM usage_records WHERE event_id = $1", [eventId]);
		expect((await pool.query("SELECT 1 FROM turn_model_call_links")).rowCount).toBe(0);
		expect((await pool.query("SELECT 1 FROM model_proxy_calls WHERE id = $1", [callId])).rowCount).toBe(1);

		await pool.query(
			"INSERT INTO usage_records(event_id, session_id, turn_id, user_id, turn_status, user_input, payload_fingerprint) VALUES ($1, $2, $3, $4, 'completed', $5, $6)",
			[eventId, randomUUID(), randomUUID(), userId, Buffer.from("encrypted"), "test-fingerprint-2"],
		);
		await pool.query("INSERT INTO turn_model_call_links(usage_event_id, model_call_id) VALUES ($1, $2)", [eventId, callId]);
		await pool.query("DELETE FROM model_proxy_calls WHERE id = $1", [callId]);
		expect((await pool.query("SELECT 1 FROM turn_model_call_links")).rowCount).toBe(0);
		expect((await pool.query("SELECT 1 FROM usage_records WHERE event_id = $1", [eventId])).rowCount).toBe(1);

		await expect(
			pool.query(
				"INSERT INTO usage_records(event_id, session_id, turn_id, user_id, group_snapshot, turn_status, user_input, payload_fingerprint) VALUES ($1, $2, $3, $4, '{}'::jsonb, 'completed', $5, $6)",
				[randomUUID(), randomUUID(), randomUUID(), userId, Buffer.from("encrypted"), "test-fingerprint-3"],
			),
		).rejects.toMatchObject({ code: "23514" });

		expect(await runMigrations(pool, "down")).toEqual(["0001_p0_schema.sql"]);
		expect((await pool.query<{ table_name: string | null }>("SELECT to_regclass('users') AS table_name")).rows[0]?.table_name).toBeNull();
		expect(await runMigrations(pool, "up")).toEqual(["0001_p0_schema.sql"]);
	});
});
