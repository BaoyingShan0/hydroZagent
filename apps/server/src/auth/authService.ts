import { randomUUID } from "node:crypto";
import { HcsRequestError, UsernameConflictError } from "./errors.js";
import { PasswordHasher } from "./passwordHasher.js";
import { validatePassword, validateUsername } from "./passwordPolicy.js";
import { InMemoryRateLimiter } from "./rateLimiter.js";
import type { AuthRepository, NewSession } from "./repository.js";
import { AccessTokenService, createRefreshToken, hashOpaqueToken, parseRefreshToken } from "./tokenService.js";
import type {
	AuthenticatedPrincipal,
	AuthPolicy,
	AuthTokensResponse,
	AuthUser,
	LoginRequest,
	PasswordResetConfirmRequest,
	RefreshRequest,
	RegisterRequest,
	RequestOrigin,
} from "./types.js";

type AuthServiceOptions = {
	repository: AuthRepository;
	passwordHasher: PasswordHasher;
	accessTokens: AccessTokenService;
	policy: AuthPolicy;
	dummyPasswordHash: string;
};

function expiresAt(now: Date, ttlSeconds: number): Date {
	return new Date(now.getTime() + ttlSeconds * 1000);
}

/** Implements the account lifecycle while keeping HTTP and PostgreSQL details outside policy code. */
export class AuthService {
	private readonly repository: AuthRepository;
	private readonly passwordHasher: PasswordHasher;
	private readonly accessTokens: AccessTokenService;
	private readonly policy: AuthPolicy;
	private readonly dummyPasswordHash: string;
	private readonly loginLimiter: InMemoryRateLimiter;
	private readonly registrationLimiter: InMemoryRateLimiter;

	constructor(options: AuthServiceOptions) {
		this.repository = options.repository;
		this.passwordHasher = options.passwordHasher;
		this.accessTokens = options.accessTokens;
		this.policy = options.policy;
		this.dummyPasswordHash = options.dummyPasswordHash;
		this.loginLimiter = new InMemoryRateLimiter(
			options.policy.loginAttemptsPerWindow,
			options.policy.loginWindowSeconds,
		);
		this.registrationLimiter = new InMemoryRateLimiter(
			options.policy.registrationsPerWindow,
			options.policy.registrationWindowSeconds,
		);
	}

	async register(input: RegisterRequest, origin: RequestOrigin): Promise<AuthTokensResponse> {
		const limit = this.registrationLimiter.consume(origin.ip, origin.now);
		if (!limit.allowed) {
			await this.auditRegistrationRejection(null, "rate_limited", origin.now);
			throw new HcsRequestError("rate_limited", 429, "注册请求过于频繁", limit.retryAfterSeconds);
		}

		const usernameResult = validateUsername(input.username);
		if (!usernameResult.valid) {
			await this.auditRegistrationRejection(null, "invalid_username", origin.now);
			throw new HcsRequestError("invalid_request", 400, usernameResult.reason);
		}
		const passwordResult = validatePassword(input.password, usernameResult.canonicalUsername);
		if (!passwordResult.valid) {
			await this.auditRegistrationRejection(usernameResult.canonicalUsername, "weak_password", origin.now);
			throw new HcsRequestError("invalid_request", 400, passwordResult.reason);
		}

		const userId = randomUUID();
		const refresh = createRefreshToken();
		const passwordHash = await this.passwordHasher.hash(input.password);
		const session = this.newSession(
			refresh.sessionId,
			userId,
			refresh.hash,
			input.device_id,
			input.client_version,
			origin.now,
		);
		let user: AuthUser;
		try {
			user = await this.repository.createSelfReportedUserWithSession(
				{ id: userId, username: usernameResult.canonicalUsername, passwordHash, createdAt: origin.now },
				session,
			);
		} catch (error: unknown) {
			if (!(error instanceof UsernameConflictError)) throw error;
			await this.auditRegistrationRejection(usernameResult.canonicalUsername, "username_unavailable", origin.now);
			throw new HcsRequestError("invalid_request", 409, "无法使用该账号名");
		}
		return this.tokenResponse(user, refresh.sessionId, refresh.token, origin.now);
	}

	async login(input: LoginRequest, origin: RequestOrigin): Promise<AuthTokensResponse> {
		const canonicalUsername = input.username.trim().toLowerCase();
		const limit = this.loginLimiter.consume(`${origin.ip}\u0000${canonicalUsername}`, origin.now);
		if (!limit.allowed) throw new HcsRequestError("rate_limited", 429, "登录请求过于频繁", limit.retryAfterSeconds);

		const user = await this.repository.findUserByUsername(canonicalUsername);
		const passwordMatches = await this.passwordHasher.verify(input.password, user?.passwordHash ?? this.dummyPasswordHash);
		if (!user || !passwordMatches) {
			if (user?.status === "active") {
				const lockedUntil = await this.repository.recordLoginFailure(
					user.id,
					origin.now,
					this.policy.failedLoginThreshold,
					this.policy.lockSeconds,
				);
				if (lockedUntil && lockedUntil.getTime() > origin.now.getTime()) {
					throw new HcsRequestError("account_locked", 423, "账号已临时锁定");
				}
			}
			throw new HcsRequestError("unauthorized", 401, "账号名或密码错误");
		}
		if (user.status === "disabled") throw new HcsRequestError("account_disabled", 403, "账号已停用");
		if (user.lockedUntil && user.lockedUntil.getTime() > origin.now.getTime()) {
			throw new HcsRequestError("account_locked", 423, "账号已临时锁定");
		}

		await this.repository.clearLoginFailures(user.id);
		const refresh = createRefreshToken();
		await this.repository.createSession(
			this.newSession(
				refresh.sessionId,
				user.id,
				refresh.hash,
				input.device_id,
				input.client_version,
				origin.now,
			),
		);
		return this.tokenResponse(user, refresh.sessionId, refresh.token, origin.now);
	}

	async refresh(input: RefreshRequest, now: Date): Promise<AuthTokensResponse> {
		const current = parseRefreshToken(input.refresh_token);
		if (!current) throw new HcsRequestError("unauthorized", 401, "刷新令牌无效");
		const replacement = createRefreshToken(current.sessionId);
		const user = await this.repository.rotateRefreshSession({
			sessionId: current.sessionId,
			expectedHash: current.hash,
			newHash: replacement.hash,
			issuedAt: now,
			expiresAt: expiresAt(now, this.policy.refreshTtlSeconds),
		});
		if (!user) throw new HcsRequestError("unauthorized", 401, "刷新令牌无效或已使用");
		return this.tokenResponse(user, current.sessionId, replacement.token, now);
	}

	async authenticateAccess(token: string, now: Date): Promise<AuthenticatedPrincipal> {
		let claims;
		try {
			claims = await this.accessTokens.verify(token, now);
		} catch {
			throw new HcsRequestError("unauthorized", 401, "访问令牌无效");
		}
		const user = await this.repository.findActiveSessionUser(claims.sessionId, now);
		if (!user || user.id !== claims.userId) throw new HcsRequestError("unauthorized", 401, "登录会话无效");
		if (user.status === "disabled") throw new HcsRequestError("account_disabled", 403, "账号已停用");
		return { userId: user.id, sessionId: claims.sessionId, role: user.role, username: user.username };
	}

	async logout(principal: AuthenticatedPrincipal, now: Date): Promise<void> {
		await this.repository.revokeSession(principal.sessionId, now);
	}

	async deactivate(principal: AuthenticatedPrincipal, now: Date): Promise<void> {
		await this.repository.deactivateUserAndRevoke(principal.userId, now);
	}

	async confirmPasswordReset(input: PasswordResetConfirmRequest, now: Date): Promise<void> {
		const tokenHash = hashOpaqueToken(input.reset_token);
		const reset = await this.repository.findValidPasswordReset(tokenHash, now);
		if (!reset) throw new HcsRequestError("unauthorized", 401, "重置令牌无效或已过期");
		const passwordResult = validatePassword(input.new_password, reset.user.username);
		if (!passwordResult.valid) throw new HcsRequestError("invalid_request", 400, passwordResult.reason);
		const passwordHash = await this.passwordHasher.hash(input.new_password);
		const consumed = await this.repository.consumePasswordReset(reset.id, tokenHash, passwordHash, now);
		if (!consumed) throw new HcsRequestError("unauthorized", 401, "重置令牌无效或已使用");
	}

	private newSession(
		id: string,
		userId: string,
		refreshTokenHash: string,
		deviceId: string,
		clientVersion: string,
		now: Date,
	): NewSession {
		return {
			id,
			userId,
			refreshTokenHash,
			issuedAt: now,
			expiresAt: expiresAt(now, this.policy.refreshTtlSeconds),
			deviceId,
			clientVersion,
		};
	}

	private async tokenResponse(user: AuthUser, sessionId: string, refreshToken: string, now: Date): Promise<AuthTokensResponse> {
		return {
			access_token: await this.accessTokens.issue(user, sessionId, now),
			refresh_token: refreshToken,
			token_type: "Bearer",
			expires_in: this.policy.accessTtlSeconds,
			user: {
				id: user.id,
				username: user.username,
				role: user.role,
				is_self_reported: user.isSelfReported,
			},
		};
	}

	private async auditRegistrationRejection(username: string | null, reasonCode: string, now: Date): Promise<void> {
		await this.repository.recordSystemAudit({
			id: randomUUID(),
			action: "registration_rejected",
			targetType: "username",
			targetId: username,
			paramsSummary: { reason_code: reasonCode },
			at: now,
		});
	}
}

export async function createAuthService(options: Omit<AuthServiceOptions, "dummyPasswordHash">): Promise<AuthService> {
	const dummyPasswordHash = await options.passwordHasher.hash(randomUUID());
	return new AuthService({ ...options, dummyPasswordHash });
}
