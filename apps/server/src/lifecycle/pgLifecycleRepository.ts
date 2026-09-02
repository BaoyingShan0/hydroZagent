import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { CleanupCounts, CleanupPolicy, LifecycleRepository } from "./repository.js";

function cutoff(now: Date, seconds: number): Date {
	return new Date(now.getTime() - seconds * 1000);
}

async function rollback(client: PoolClient): Promise<void> {
	await client.query("ROLLBACK").catch(() => undefined);
}

function count(result: { rowCount: number | null }): number {
	return result.rowCount ?? 0;
}

export class PgLifecycleRepository implements LifecycleRepository {
	private readonly pool: Pool;

	constructor(pool: Pool) {
		this.pool = pool;
	}

	async recoverInterruptedCalls(interruptedBefore: Date, now: Date): Promise<number> {
		const result = await this.pool.query(
			`UPDATE model_proxy_calls
			 SET status = 'error', ended_at = $2, error_code = 'server_interrupted',
			     latency_ms = GREATEST(0, floor(extract(epoch FROM ($2 - started_at)) * 1000)::integer)
			 WHERE status = 'in_progress' AND started_at < $1`,
			[interruptedBefore, now],
		);
		return count(result);
	}

	async cleanup(policy: CleanupPolicy, now: Date): Promise<CleanupCounts> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			const usageRecords = count(await client.query("DELETE FROM usage_records WHERE received_at < $1", [cutoff(now, policy.usageRetentionSeconds)]));
			const consents = count(
				await client.query(
					`DELETE FROM consents
					 WHERE COALESCE(withdrawn_at, invalidated_at) IS NOT NULL
					   AND COALESCE(withdrawn_at, invalidated_at) < $1`,
					[cutoff(now, policy.consentRetentionSeconds)],
				),
			);
			const modelCalls = count(
				await client.query("DELETE FROM model_proxy_calls WHERE status <> 'in_progress' AND COALESCE(ended_at, started_at) < $1", [
					cutoff(now, policy.modelCallRetentionSeconds),
				]),
			);
			const authSessions = count(
				await client.query("DELETE FROM auth_sessions WHERE COALESCE(revoked_at, expires_at) < $1", [
					cutoff(now, policy.authSessionRetentionSeconds),
				]),
			);
			const passwordResets = count(
				await client.query("DELETE FROM password_resets WHERE COALESCE(used_at, expires_at) < $1", [
					cutoff(now, policy.passwordResetRetentionSeconds),
				]),
			);
			const audits = count(
				await client.query(
					`DELETE FROM admin_audit AS audit
					 WHERE audit.at < $1
					   AND NOT EXISTS (SELECT 1 FROM password_resets AS reset WHERE reset.issued_by_audit_id = audit.id)`,
					[cutoff(now, policy.auditRetentionSeconds)],
				),
			);
			const anonymized = await client.query<{ id: string }>(
				`SELECT users.id FROM users
				 WHERE users.status = 'disabled' AND users.anonymized_at IS NULL
				   AND NOT EXISTS (SELECT 1 FROM usage_records WHERE usage_records.user_id = users.id)
				   AND NOT EXISTS (SELECT 1 FROM consents WHERE consents.user_id = users.id)
				   AND NOT EXISTS (SELECT 1 FROM auth_sessions WHERE auth_sessions.user_id = users.id)
				 FOR UPDATE`,
			);
			for (const user of anonymized.rows) {
				await client.query(
					`UPDATE users
					 SET username = $2, password_hash = $3, failed_login_count = 0, locked_until = NULL, anonymized_at = $4
					 WHERE id = $1`,
					[user.id, `deleted-${user.id}`, `disabled:${randomBytes(32).toString("hex")}`, now],
				);
			}
			const counts: CleanupCounts = {
				usageRecords,
				consents,
				modelCalls,
				authSessions,
				passwordResets,
				audits,
				anonymizedUsers: anonymized.rows.length,
				recoveredCalls: 0,
			};
			await client.query(
				`INSERT INTO admin_audit(id, actor_type, action, target_type, params_summary, at)
				 VALUES ($1, 'system', 'retention_cleanup', 'retention', $2::jsonb, $3)`,
				[randomUUID(), JSON.stringify(counts), now],
			);
			await client.query("COMMIT");
			return counts;
		} catch (error: unknown) {
			await rollback(client);
			throw error;
		} finally {
			client.release();
		}
	}

	async countKeyReferences(keyId: string): Promise<number> {
		const result = await this.pool.query<{ references: string }>(
			`SELECT (
			   count(*) FILTER (WHERE convert_from(user_input, 'UTF8')::jsonb ->> 'key_id' = $1)
			   + count(*) FILTER (
			       WHERE assistant_final IS NOT NULL
			         AND convert_from(assistant_final, 'UTF8')::jsonb ->> 'key_id' = $1
			     )
			 )::text AS references
			 FROM usage_records`,
			[keyId],
		);
		return Number(result.rows[0]?.references ?? "0");
	}
}
