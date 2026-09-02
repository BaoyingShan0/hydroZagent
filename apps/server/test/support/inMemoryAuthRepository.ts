import { randomUUID } from "node:crypto";
import { UsernameConflictError } from "../../src/auth/errors.js";
import type { AuthRepository, NewSelfReportedUser, NewSession, ValidPasswordReset } from "../../src/auth/repository.js";
import type { AuthUser } from "../../src/auth/types.js";

type StoredSession = NewSession & { revokedAt: Date | null };
type StoredReset = { id: string; userId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null };

export class InMemoryAuthRepository implements AuthRepository {
	readonly users = new Map<string, AuthUser>();
	readonly sessions = new Map<string, StoredSession>();
	readonly resets = new Map<string, StoredReset>();
	readonly audits: Array<{
		id: string;
		action: string;
		targetType: string;
		targetId: string | null;
		paramsSummary: Record<string, string | number | boolean | null>;
		at: Date;
	}> = [];

	seedUser(options: { username: string; passwordHash: string; role?: AuthUser["role"]; status?: AuthUser["status"] }): AuthUser {
		const user: AuthUser = {
			id: randomUUID(),
			username: options.username,
			passwordHash: options.passwordHash,
			role: options.role ?? "user",
			status: options.status ?? "active",
			isSelfReported: false,
			failedLoginCount: 0,
			lockedUntil: null,
		};
		this.users.set(user.id, user);
		return user;
	}

	seedReset(userId: string, tokenHash: string, expiresAt: Date): StoredReset {
		const reset = { id: randomUUID(), userId, tokenHash, expiresAt, usedAt: null };
		this.resets.set(reset.id, reset);
		return reset;
	}

	async createSelfReportedUserWithSession(user: NewSelfReportedUser, session: NewSession): Promise<AuthUser> {
		if ([...this.users.values()].some((candidate) => candidate.username.toLowerCase() === user.username.toLowerCase())) {
			throw new UsernameConflictError();
		}
		const created: AuthUser = {
			id: user.id,
			username: user.username,
			passwordHash: user.passwordHash,
			role: "user",
			status: "active",
			isSelfReported: true,
			failedLoginCount: 0,
			lockedUntil: null,
		};
		this.users.set(created.id, created);
		this.sessions.set(session.id, { ...session, revokedAt: null });
		return created;
	}

	async findUserByUsername(canonicalUsername: string): Promise<AuthUser | null> {
		return [...this.users.values()].find((user) => user.username.toLowerCase() === canonicalUsername) ?? null;
	}

	async recordLoginFailure(userId: string, now: Date, threshold: number, lockSeconds: number): Promise<Date | null> {
		const user = this.users.get(userId);
		if (!user) return null;
		user.failedLoginCount += 1;
		if (user.failedLoginCount >= threshold) user.lockedUntil = new Date(now.getTime() + lockSeconds * 1000);
		return user.lockedUntil;
	}

	async clearLoginFailures(userId: string): Promise<void> {
		const user = this.users.get(userId);
		if (!user) return;
		user.failedLoginCount = 0;
		user.lockedUntil = null;
	}

	async createSession(session: NewSession): Promise<void> {
		this.sessions.set(session.id, { ...session, revokedAt: null });
	}

	async rotateRefreshSession(options: {
		sessionId: string;
		expectedHash: string;
		newHash: string;
		issuedAt: Date;
		expiresAt: Date;
	}): Promise<AuthUser | null> {
		const session = this.sessions.get(options.sessionId);
		if (
			!session ||
			session.revokedAt ||
			session.expiresAt.getTime() <= options.issuedAt.getTime() ||
			session.refreshTokenHash !== options.expectedHash
		) {
			return null;
		}
		const user = this.users.get(session.userId);
		if (!user || user.status !== "active") return null;
		session.refreshTokenHash = options.newHash;
		session.issuedAt = options.issuedAt;
		session.expiresAt = options.expiresAt;
		return user;
	}

	async findActiveSessionUser(sessionId: string, now: Date): Promise<AuthUser | null> {
		const session = this.sessions.get(sessionId);
		if (!session || session.revokedAt || session.expiresAt.getTime() <= now.getTime()) return null;
		return this.users.get(session.userId) ?? null;
	}

	async revokeSession(sessionId: string, now: Date): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (session && !session.revokedAt) session.revokedAt = now;
	}

	async revokeAllSessions(userId: string, now: Date): Promise<void> {
		for (const session of this.sessions.values()) {
			if (session.userId === userId && !session.revokedAt) session.revokedAt = now;
		}

	}

	async deactivateUserAndRevoke(userId: string, now: Date): Promise<void> {
		const user = this.users.get(userId);
		if (user) user.status = "disabled";
		await this.revokeAllSessions(userId, now);
	}

	async findValidPasswordReset(tokenHash: string, now: Date): Promise<ValidPasswordReset | null> {
		const reset = [...this.resets.values()].find(
			(candidate) => candidate.tokenHash === tokenHash && !candidate.usedAt && candidate.expiresAt.getTime() > now.getTime(),
		);
		if (!reset) return null;
		const user = this.users.get(reset.userId);
		return user?.status === "active" ? { id: reset.id, user } : null;
	}

	async consumePasswordReset(resetId: string, tokenHash: string, passwordHash: string, now: Date): Promise<boolean> {
		const reset = this.resets.get(resetId);
		if (!reset || reset.tokenHash !== tokenHash || reset.usedAt || reset.expiresAt.getTime() <= now.getTime()) return false;
		const user = this.users.get(reset.userId);
		if (!user || user.status !== "active") return false;
		reset.usedAt = now;
		user.passwordHash = passwordHash;
		user.failedLoginCount = 0;
		user.lockedUntil = null;
		await this.revokeAllSessions(user.id, now);
		return true;
	}

	async recordSystemAudit(options: {
		id: string;
		action: string;
		targetType: string;
		targetId: string | null;
		paramsSummary: Record<string, string | number | boolean | null>;
		at: Date;
	}): Promise<void> {
		this.audits.push(options);
	}
}
