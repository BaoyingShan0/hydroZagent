#!/usr/bin/env node

import { createDatabasePool } from "../db/pool.js";
import { PgLifecycleRepository } from "./pgLifecycleRepository.js";
import type { CleanupPolicy } from "./repository.js";

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required lifecycle setting ${name}`);
	return value;
}

function positiveInteger(name: string): number {
	const value = Number(required(name));
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
	return value;
}

function policy(): CleanupPolicy {
	return {
		usageRetentionSeconds: positiveInteger("HCS_USAGE_RETENTION_SECONDS"),
		consentRetentionSeconds: positiveInteger("HCS_CONSENT_RETENTION_SECONDS"),
		modelCallRetentionSeconds: positiveInteger("HCS_MODEL_CALL_RETENTION_SECONDS"),
		authSessionRetentionSeconds: positiveInteger("HCS_AUTH_SESSION_RETENTION_SECONDS"),
		passwordResetRetentionSeconds: positiveInteger("HCS_PASSWORD_RESET_RETENTION_SECONDS"),
		auditRetentionSeconds: positiveInteger("HCS_AUDIT_RETENTION_SECONDS"),
		proxyMaximumTimeoutSeconds: positiveInteger("HCS_PROXY_MAX_TIMEOUT_SECONDS"),
	};
}

async function execute(): Promise<void> {
	if (process.argv.length !== 2) throw new Error("Lifecycle cleanup does not accept command-line settings");
	const pool = createDatabasePool(required("HCS_DATABASE_URL"));
	try {
		const counts = await new PgLifecycleRepository(pool).cleanup(policy(), new Date());
		process.stdout.write(`${JSON.stringify({ event: "retention_cleanup_complete", counts })}\n`);
	} finally {
		await pool.end();
	}
}

await execute().catch(() => {
	process.stderr.write("Lifecycle cleanup failed.\n");
	process.exitCode = 1;
});
