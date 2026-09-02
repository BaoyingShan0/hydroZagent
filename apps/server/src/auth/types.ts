import type {
	AuthTokensResponse,
	LoginRequest,
	PasswordResetConfirmRequest,
	RefreshRequest,
	RegisterRequest,
} from "../contracts/generated.js";

export type UserRole = "user" | "admin";
export type UserStatus = "active" | "disabled";

export type AuthUser = {
	id: string;
	username: string;
	passwordHash: string;
	role: UserRole;
	status: UserStatus;
	isSelfReported: boolean;
	failedLoginCount: number;
	lockedUntil: Date | null;
};

export type AuthenticatedPrincipal = {
	userId: string;
	sessionId: string;
	role: UserRole;
	username: string;
};

export type RequestOrigin = {
	ip: string;
	now: Date;
};

export type AuthPolicy = {
	accessTtlSeconds: number;
	refreshTtlSeconds: number;
	loginWindowSeconds: number;
	loginAttemptsPerWindow: number;
	registrationWindowSeconds: number;
	registrationsPerWindow: number;
	failedLoginThreshold: number;
	lockSeconds: number;
};

export type { AuthTokensResponse, LoginRequest, PasswordResetConfirmRequest, RefreshRequest, RegisterRequest };
