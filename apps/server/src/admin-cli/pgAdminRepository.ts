import type { Pool, PoolClient } from "pg";
import { UsernameConflictError } from "../auth/errors.js";
import type { AdminRepository, AdminUserRole } from "./types.js";

function hasDatabaseCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function rollback(client: PoolClient): Promise<void> {
	await client.query("ROLLBACK").catch(() => undefined);
}

export class PgAdminRepository implements AdminRepository {
	private readonly pool: Pool;

	constructor(pool: Pool) {
		this.pool = pool;
	}

	async seedFirstAdmin(options: {
		userId: string;
		username: string;
		passwordHash: string;
		auditId: string;
		at: Date;
	}): Promise<void> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			await client.query("SELECT pg_advisory_xact_lock($1)", [934_210_887]);
			const existing = await client.query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
			if (existing.rowCount !== 0) throw new UsernameConflictError();
			await client.query(
				`INSERT INTO users(id, username, password_hash, role, status, is_self_reported, created_at)
				 VALUES ($1, $2, $3, 'admin', 'active', false, $4)`,
				[options.userId, options.username, options.passwordHash, options.at],
			);
			await client.query(
				`INSERT INTO admin_audit(id, actor_type, action, target_type, target_id, params_summary, at)
				 VALUES ($1, 'system', 'seed_admin', 'user', $2, $3::jsonb, $4)`,
				[options.auditId, options.userId, JSON.stringify({ role: "admin", is_self_reported: false }), options.at],
			);
			await client.query("COMMIT");
		} catch (error: unknown) {
			await rollback(client);
			if (hasDatabaseCode(error, "23505")) throw new UsernameConflictError();
			throw error;
		} finally {
			client.release();
		}
	}

	async createUser(options: {
		userId: string;
		username: string;
		passwordHash: string;
		role: AdminUserRole;
		actorPrincipal: string;
		auditId: string;
		at: Date;
	}): Promise<void> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(
				`INSERT INTO users(id, username, password_hash, role, status, is_self_reported, created_at)
				 VALUES ($1, $2, $3, $4, 'active', false, $5)`,
				[options.userId, options.username, options.passwordHash, options.role, options.at],
			);
			await client.query(
				`INSERT INTO admin_audit(id, actor_type, actor_principal, action, target_type, target_id, params_summary, at)
				 VALUES ($1, 'os_operator', $2, 'create_user', 'user', $3, $4::jsonb, $5)`,
				[
					options.auditId,
					options.actorPrincipal,
					options.userId,
					JSON.stringify({ role: options.role, is_self_reported: false }),
					options.at,
				],
			);
			await client.query("COMMIT");
		} catch (error: unknown) {
			await rollback(client);
			if (hasDatabaseCode(error, "23505")) throw new UsernameConflictError();
			throw error;
		} finally {
			client.release();
		}
	}

	async setRole(options: {
		username: string;
		role: AdminUserRole;
		actorPrincipal: string;
		auditId: string;
		at: Date;
	}): Promise<boolean> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			const changed = await client.query<{ id: string; old_role: string }>(
				`WITH target_account AS (
				   SELECT id, role AS old_role FROM users WHERE lower(username) = $1 FOR UPDATE
				 )
				 UPDATE users SET role = $2
				 FROM target_account WHERE users.id = target_account.id
				 RETURNING users.id, target_account.old_role`,
				[options.username, options.role],
			);
			const user = changed.rows[0];
			if (!user) {
				await client.query("ROLLBACK");
				return false;
			}
			await client.query(
				`INSERT INTO admin_audit(id, actor_type, actor_principal, action, target_type, target_id, params_summary, at)
				 VALUES ($1, 'os_operator', $2, 'set_role', 'user', $3, $4::jsonb, $5)`,
				[
					options.auditId,
					options.actorPrincipal,
					user.id,
					JSON.stringify({ old_role: user.old_role, new_role: options.role }),
					options.at,
				],
			);
			await client.query("COMMIT");
			return true;
		} catch (error: unknown) {
			await rollback(client);
			throw error;
		} finally {
			client.release();
		}
	}

	async deleteUsage(options: {
		eventId: string;
		actorPrincipal: string;
		auditId: string;
		at: Date;
	}): Promise<boolean> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			const deleted = await client.query("DELETE FROM usage_records WHERE event_id = $1", [options.eventId]);
			if (deleted.rowCount === 0) {
				await client.query("ROLLBACK");
				return false;
			}
			await client.query(
				`INSERT INTO admin_audit(id, actor_type, actor_principal, action, target_type, target_id, params_summary, at)
				 VALUES ($1, 'os_operator', $2, 'delete_usage', 'usage_record', $3, $4::jsonb, $5)`,
				[options.auditId, options.actorPrincipal, options.eventId, JSON.stringify({ record_count: 1 }), options.at],
			);
			await client.query("COMMIT");
			return true;
		} catch (error: unknown) {
			await rollback(client);
			throw error;
		} finally {
			client.release();
		}
	}

	async issuePasswordReset(options: {
		username: string;
		tokenHash: string;
		resetId: string;
		expiresAt: Date;
		actorPrincipal: string;
		auditId: string;
		at: Date;
	}): Promise<boolean> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			const user = await client.query<{ id: string }>(
				"SELECT id FROM users WHERE lower(username) = $1 AND status = 'active' FOR UPDATE",
				[options.username],
			);
			const userId = user.rows[0]?.id;
			if (!userId) {
				await client.query("ROLLBACK");
				return false;
			}
			await client.query(
				`INSERT INTO admin_audit(id, actor_type, actor_principal, action, target_type, target_id, params_summary, at)
				 VALUES ($1, 'os_operator', $2, 'issue_password_reset', 'user', $3, $4::jsonb, $5)`,
				[
					options.auditId,
					options.actorPrincipal,
					userId,
					JSON.stringify({ expires_at: options.expiresAt.toISOString() }),
					options.at,
				],
			);
			await client.query(
				`INSERT INTO password_resets(id, user_id, token_hash, expires_at, issued_by_audit_id)
				 VALUES ($1, $2, $3, $4, $5)`,
				[options.resetId, userId, options.tokenHash, options.expiresAt, options.auditId],
			);
			await client.query("COMMIT");
			return true;
		} catch (error: unknown) {
			await rollback(client);
			throw error;
		} finally {
			client.release();
		}
	}
}
