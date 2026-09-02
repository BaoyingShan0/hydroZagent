#!/usr/bin/env node

import { createDatabasePool } from "../db/pool.js";

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required restore verification setting ${name}`);
	return value;
}

function positiveInteger(name: string): number {
	const value = Number(required(name));
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
	return value;
}

async function execute(): Promise<void> {
	const pool = createDatabasePool(required("HCS_DATABASE_URL"));
	try {
		const result = await pool.query<{ expired_usage: string; orphan_links: string; interrupted_calls: string }>(
			`SELECT
			   (SELECT count(*) FROM usage_records WHERE received_at < now() - ($1::integer * interval '1 second'))::text AS expired_usage,
			   (SELECT count(*) FROM turn_model_call_links AS link
			      WHERE NOT EXISTS (SELECT 1 FROM usage_records WHERE event_id = link.usage_event_id)
			         OR NOT EXISTS (SELECT 1 FROM model_proxy_calls WHERE id = link.model_call_id))::text AS orphan_links,
			   (SELECT count(*) FROM model_proxy_calls
			      WHERE status = 'in_progress' AND started_at < now() - ($2::integer * interval '1 second'))::text AS interrupted_calls`,
			[positiveInteger("HCS_USAGE_RETENTION_SECONDS"), positiveInteger("HCS_PROXY_MAX_TIMEOUT_SECONDS")],
		);
		const row = result.rows[0];
		if (!row || row.expired_usage !== "0" || row.orphan_links !== "0" || row.interrupted_calls !== "0") {
			throw new Error("Restored database integrity or retention verification failed");
		}
		process.stdout.write(`${JSON.stringify({ event: "restore_verification_complete" })}\n`);
	} finally {
		await pool.end();
	}
}

await execute().catch(() => {
	process.stderr.write("Restore verification failed.\n");
	process.exitCode = 1;
});
