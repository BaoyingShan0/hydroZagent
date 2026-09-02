import type { AuthUser } from "./types.js";

export type NewSession = {
	id: string;
	userId: string;
	refreshTokenHash: string;
	issuedAt: Date;
	expiresAt: Date;
	deviceId: string;
	clientVersion: string;
};

export type NewSelfReportedUser = {
	id: string;
	username: string;
	passwordHash: string;
	createdAt: Date;
};

export type ValidPasswordReset = {
	id: string;
	user: AuthUser;
};

export interface AuthRepository {
	createSelfReportedUserWithSession(user: NewSelfReportedUser, session: NewSession): Promise<AuthUser>;
	findUserByUsername(canonicalUsername: string): Promise<AuthUser | null>;
	recordLoginFailure(userId: string, now: Date, threshold: number, lockSeconds: number): Promise<Date | null>;
	clearLoginFailures(userId: string): Promise<void>;
	createSession(session: NewSession): Promise<void>;
	rotateRefreshSession(options: {
		sessionId: string;
		expectedHash: string;
		newHash: string;
		issuedAt: Date;
		expiresAt: Date;
	}): Promise<AuthUser | null>;
	findActiveSessionUser(sessionId: string, now: Date): Promise<AuthUser | null>;
	revokeSession(sessionId: string, now: Date): Promise<void>;
	revokeAllSessions(userId: string, now: Date): Promise<void>;
	deactivateUserAndRevoke(userId: string, now: Date): Promise<void>;
	findValidPasswordReset(tokenHash: string, now: Date): Promise<ValidPasswordReset | null>;
	consumePasswordReset(resetId: string, tokenHash: string, passwordHash: string, now: Date): Promise<boolean>;
	recordSystemAudit(options: {
		id: string;
		action: string;
		targetType: string;
		targetId: string | null;
		paramsSummary: Record<string, string | number | boolean | null>;
		at: Date;
	}): Promise<void>;
}
