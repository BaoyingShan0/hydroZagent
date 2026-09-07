import type { Pool, PoolClient } from "pg";
import { UsernameConflictError } from "./errors.js";
import type { AuthRepository, NewSelfReportedUser, NewSession, ValidPasswordReset } from "./repository.js";
import type { AuthUser, UserRole, UserStatus } from "./types.js";

type UserRow = {
	id: string;
	username: string;
	password_hash: string;
	role: UserRole;
	status: UserStatus;
	is_self_reported: boolean;
	failed_login_count: number;
	locked_until: Date | null;
};

function rowToUser(row: UserRow): AuthUser {
	return {
		id: row.id,
		username: row.username,
		passwordHash: row.password_hash,
		role: row.role,
		status: row.status,
		isSelfReported: row.is_self_reported,
		failedLoginCount: row.failed_login_count,
		lockedUntil: row.locked_until,
	};
}

function hasDatabaseCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function rollback(client: PoolClient): Promise<void> {
	await client.query("ROLLBACK").catch(() => undefined);
}

export class PgAuthRepository implements AuthRepository {
	private readonly pool: Pool;

	constructor(pool: Pool) {
		this.pool = pool;
	}

	async createSelfReportedUserWithSession(user: NewSelfReportedUser, session: NewSession): Promise<AuthUser> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			const result = await client.query<UserRow>(
				`INSERT INTO users(id, username, password_hash, role, status, is_self_reported, created_at)
				 VALUES ($1, $2, $3, 'user', 'active', true, $4)
				 RETURNING id, username, password_hash, role, status, is_self_reported, failed_login_count, locked_until`,
				[user.id, user.username, user.passwordHash, user.createdAt],
			);
			await client.query(
				`INSERT INTO auth_sessions(id, user_id, refresh_token_hash, issued_at, expires_at, device_id, client_version)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[
					session.id,
					session.userId,
					session.refreshTokenHash,
					session.issuedAt,
					session.expiresAt,
					session.deviceId,
					session.clientVersion,
				],
			);
			await client.query("COMMIT");
			const row = result.rows[0];
			if (!row) throw new Error("User insert returned no row");
			return rowToUser(row);
		} catch (error: unknown) {
			await rollback(client);
			if (hasDatabaseCode(error, "23505")) throw new UsernameConflictError();
			throw error;
		} finally {
			client.release();
		}
	}

	async findUserByUsername(canonicalUsername: string): Promise<AuthUser | null> {
		const result = await this.pool.query<UserRow>(
			`SELECT id, username, password_hash, role, status, is_self_reported, failed_login_count, locked_until
			 FROM users WHERE lower(username) = $1`,
			[canonicalUsername],
		);
		return result.rows[0] ? rowToUser(result.rows[0]) : null;
	}

	async recordLoginFailure(userId: string, now: Date, threshold: number, lockSeconds: number): Promise<Date | null> {
		const result = await this.pool.query<{ locked_until: Date | null }>(
			`UPDATE users
			 SET failed_login_count = failed_login_count + 1,
			     locked_until = CASE
			       WHEN failed_login_count + 1 >= $3 THEN $2::timestamptz + ($4::integer * interval '1 second')
			       ELSE locked_until
			     END
			 WHERE id = $1
			 RETURNING locked_until`,
			[userId, now, threshold, lockSeconds],
		);
		return result.rows[0]?.locked_until ?? null;
	}

	async clearLoginFailures(userId: string): Promise<void> {
		await this.pool.query("UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1", [userId]);
	}

	async createSession(session: NewSession): Promise<void> {
		await this.pool.query(
			`INSERT INTO auth_sessions(id, user_id, refresh_token_hash, issued_at, expires_at, device_id, client_version)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[
				session.id,
				session.userId,
				session.refreshTokenHash,
				session.issuedAt,
				session.expiresAt,
				session.deviceId,
				session.clientVersion,
			],
		);
	}

	async rotateRefreshSession(options: {
		sessionId: string;
		expectedHash: string;
		newHash: string;
		issuedAt: Date;
		expiresAt: Date;
	}): Promise<AuthUser | null> {
		const result = await this.pool.query<UserRow>(
			`UPDATE auth_sessions AS session
			 SET refresh_token_hash = $3, issued_at = $4, expires_at = $5
			 FROM users AS account
			 WHERE session.id = $1
			   AND session.refresh_token_hash = $2
			   AND session.revoked_at IS NULL
			   AND session.expires_at > $4
			   AND account.id = session.user_id
			   AND account.status = 'active'
			 RETURNING account.id, account.username, account.password_hash, account.role, account.status,
			           account.is_self_reported, account.failed_login_count, account.locked_until`,
			[options.sessionId, options.expectedHash, options.newHash, options.issuedAt, options.expiresAt],
		);
		return result.rows[0] ? rowToUser(result.rows[0]) : null;
	}

	async findActiveSessionUser(sessionId: string, now: Date): Promise<AuthUser | null> {
		const result = await this.pool.query<UserRow>(
			`SELECT account.id, account.username, account.password_hash, account.role, account.status,
			        account.is_self_reported, account.failed_login_count, account.locked_until
			 FROM auth_sessions AS session
			 JOIN users AS account ON account.id = session.user_id
			 WHERE session.id = $1 AND session.revoked_at IS NULL AND session.expires_at > $2`,
			[sessionId, now],
		);
		return result.rows[0] ? rowToUser(result.rows[0]) : null;
	}

	async revokeSession(sessionId: string, now: Date): Promise<void> {
		await this.pool.query("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE id = $1", [sessionId, now]);
	}

	async revokeAllSessions(userId: string, now: Date): Promise<void> {
		await this.pool.query("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE user_id = $1", [userId, now]);
	}

	async deactivateUserAndRevoke(userId: string, now: Date): Promise<void> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			await client.query("UPDATE users SET status = 'disabled' WHERE id = $1", [userId]);
			await client.query("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE user_id = $1", [userId, now]);
			await client.query(
				"UPDATE consents SET invalidated_at = COALESCE(invalidated_at, $2) WHERE user_id = $1 AND withdrawn_at IS NULL",
				[userId, now],
			);
			await client.query("COMMIT");
		} catch (error: unknown) {
			await rollback(client);
			throw error;
		} finally {
			client.release();
		}
	}

	async findValidPasswordReset(tokenHash: string, now: Date): Promise<ValidPasswordReset | null> {
		const result = await this.pool.query<UserRow & { reset_id: string }>(
			`SELECT reset.id AS reset_id, account.id, account.username, account.password_hash, account.role,
			        account.status, account.is_self_reported, account.failed_login_count, account.locked_until
			 FROM password_resets AS reset
			 JOIN users AS account ON account.id = reset.user_id
			 WHERE reset.token_hash = $1 AND reset.used_at IS NULL AND reset.expires_at > $2 AND account.status = 'active'`,
			[tokenHash, now],
		);
		const row = result.rows[0];
		return row ? { id: row.reset_id, user: rowToUser(row) } : null;
	}

	async consumePasswordReset(resetId: string, tokenHash: string, passwordHash: string, now: Date): Promise<boolean> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			const reset = await client.query<{ user_id: string }>(
				`SELECT user_id FROM password_resets
				 WHERE id = $1 AND token_hash = $2 AND used_at IS NULL AND expires_at > $3
				 FOR UPDATE`,
				[resetId, tokenHash, now],
			);
			const userId = reset.rows[0]?.user_id;
			if (!userId) {
				await client.query("ROLLBACK");
				return false;
			}
			await client.query(
				"UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL WHERE id = $1 AND status = 'active'",
				[userId, passwordHash],
			);
			await client.query("UPDATE password_resets SET used_at = $2 WHERE id = $1", [resetId, now]);
			await client.query("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE user_id = $1", [userId, now]);
			await client.query("COMMIT");
			return true;
		} catch (error: unknown) {
			await rollback(client);
			throw error;
		} finally {
			client.release();
		}
	}

	async recordSystemAudit(options: {
		id: string;
		action: string;
		targetType: string;
		targetId: string | null;
		paramsSummary: Record<string, string | number | boolean | null>;
		at: Date;
	}): Promise<void> {
		await this.pool.query(
			`INSERT INTO admin_audit(id, actor_type, action, target_type, target_id, params_summary, at)
			 VALUES ($1, 'system', $2, $3, $4, $5::jsonb, $6)`,
			[options.id, options.action, options.targetType, options.targetId, JSON.stringify(options.paramsSummary), options.at],
		);
	}
}
