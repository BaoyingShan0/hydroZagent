import type { Pool } from "pg";
import type { ConsentRepository } from "./repository.js";

export class PgConsentRepository implements ConsentRepository {
	private readonly pool: Pool;

	constructor(pool: Pool) {
		this.pool = pool;
	}

	async activateNotice(noticeVersion: string, now: Date): Promise<number> {
		const result = await this.pool.query(
			`UPDATE consents SET invalidated_at = $2
			 WHERE notice_version <> $1 AND withdrawn_at IS NULL AND invalidated_at IS NULL`,
			[noticeVersion, now],
		);
		return result.rowCount ?? 0;
	}

	async recordConsent(options: {
		id: string;
		userId: string;
		noticeVersion: string;
		clientVersion: string;
		consentedAt: Date;
	}): Promise<boolean> {
		const result = await this.pool.query(
			`INSERT INTO consents(id, user_id, notice_version, consented_at, client_version)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (user_id, notice_version)
			 WHERE withdrawn_at IS NULL AND invalidated_at IS NULL
			 DO NOTHING`,
			[options.id, options.userId, options.noticeVersion, options.consentedAt, options.clientVersion],
		);
		return result.rowCount === 1;
	}

	async withdrawConsent(userId: string, noticeVersion: string, now: Date): Promise<boolean> {
		const result = await this.pool.query(
			`UPDATE consents SET withdrawn_at = $3
			 WHERE user_id = $1 AND notice_version = $2 AND withdrawn_at IS NULL AND invalidated_at IS NULL`,
			[userId, noticeVersion, now],
		);
		return (result.rowCount ?? 0) > 0;
	}

	async hasValidConsent(userId: string, noticeVersion: string): Promise<boolean> {
		const result = await this.pool.query(
			`SELECT 1 FROM consents
			 WHERE user_id = $1 AND notice_version = $2 AND withdrawn_at IS NULL AND invalidated_at IS NULL
			 LIMIT 1`,
			[userId, noticeVersion],
		);
		return result.rowCount === 1;
	}
}
