import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { HcsRequestError } from "../auth/errors.js";
import type { EncryptedUsageRecord, UsageIngestResult, UsageRepository } from "./repository.js";

async function rollback(client: PoolClient): Promise<void> {
	await client.query("ROLLBACK").catch(() => undefined);
}

export class PgUsageRepository implements UsageRepository {
	private readonly pool: Pool;

	constructor(pool: Pool) {
		this.pool = pool;
	}

	async ingest(record: EncryptedUsageRecord): Promise<UsageIngestResult> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [record.request.event_id]);
			const existing = await client.query<{ payload_fingerprint: string }>(
				"SELECT payload_fingerprint FROM usage_records WHERE event_id = $1 FOR UPDATE",
				[record.request.event_id],
			);
			const existingFingerprint = existing.rows[0]?.payload_fingerprint;
			if (existingFingerprint !== undefined) {
				const conflict = existingFingerprint !== record.payloadFingerprint;
				if (conflict) {
					await client.query(
						`INSERT INTO admin_audit(id, actor_type, action, target_type, target_id, params_summary, at)
						 VALUES ($1, 'system', 'usage_duplicate_conflict', 'usage_record', $2, $3::jsonb, $4)`,
						[
							randomUUID(),
							record.request.event_id,
							JSON.stringify({ model_call_count: record.request.model_call_ids.length, payload_changed: true }),
							record.receivedAt,
						],
					);
				}
				await client.query("COMMIT");
				return { deduplicated: true, conflict };
			}

			if (record.request.model_call_ids.length > 0) {
				const owned = await client.query<{ id: string }>(
					`SELECT id FROM model_proxy_calls
					 WHERE id = ANY($1::uuid[]) AND user_id = $2
					 FOR SHARE`,
					[record.request.model_call_ids, record.userId],
				);
				if (owned.rowCount !== record.request.model_call_ids.length) {
					throw new HcsRequestError("invalid_request", 400, "模型调用关联无效");
				}
			}

			await client.query(
				`INSERT INTO usage_records(
				   event_id, session_id, turn_id, user_id, group_snapshot, received_at, client_created_at,
				   task_category, model, client_version, device_id, turn_status, user_input, assistant_final,
				   anonymous, payload_fingerprint
				 ) VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
				[
					record.request.event_id,
					record.request.session_id,
					record.request.turn_id,
					record.userId,
					record.receivedAt,
					new Date(record.request.client_created_at),
					record.request.task_category,
					record.request.model,
					record.request.client_version,
					record.request.device_id,
					record.request.turn_status,
					Buffer.from(record.userInput),
					record.assistantFinal === null ? null : Buffer.from(record.assistantFinal),
					record.request.anonymous,
					record.payloadFingerprint,
				],
			);
			for (const callId of record.request.model_call_ids) {
				await client.query(
					"INSERT INTO turn_model_call_links(usage_event_id, model_call_id) VALUES ($1, $2)",
					[record.request.event_id, callId],
				);
			}
			await client.query("COMMIT");
			return { deduplicated: false, conflict: false };
		} catch (error: unknown) {
			await rollback(client);
			throw error;
		} finally {
			client.release();
		}
	}
}
