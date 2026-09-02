import type { Pool } from "pg";
import type { ModelCallSettlement, ProxyCallRepository } from "./repository.js";

export class PgProxyCallRepository implements ProxyCallRepository {
	private readonly pool: Pool;

	constructor(pool: Pool) {
		this.pool = pool;
	}

	async start(options: { id: string; userId: string; model: string; startedAt: Date }): Promise<void> {
		await this.pool.query(
			`INSERT INTO model_proxy_calls(id, user_id, model, started_at, status)
			 VALUES ($1, $2, $3, $4, 'in_progress')`,
			[options.id, options.userId, options.model, options.startedAt],
		);
	}

	async settle(id: string, settlement: ModelCallSettlement): Promise<void> {
		await this.pool.query(
			`UPDATE model_proxy_calls
			 SET ended_at = $2, status = $3, error_code = $4, prompt_tokens = $5,
			     completion_tokens = $6, latency_ms = $7
			 WHERE id = $1 AND status = 'in_progress'`,
			[
				id,
				settlement.endedAt,
				settlement.status,
				settlement.errorCode,
				settlement.promptTokens,
				settlement.completionTokens,
				settlement.latencyMs,
			],
		);
	}
}
