import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify, type CryptoKey } from "jose";
import type { AuthUser, UserRole } from "./types.js";

export type VerifiedAccessToken = {
	userId: string;
	sessionId: string;
	jti: string;
	role: UserRole;
};

export type RefreshTokenParts = {
	sessionId: string;
	token: string;
	hash: string;
};

export class AccessTokenService {
	readonly issuer: string;
	readonly audience: string;
	readonly ttlSeconds: number;
	private readonly privateKey: CryptoKey;
	private readonly publicKey: CryptoKey;

	constructor(options: {
		issuer: string;
		audience: string;
		ttlSeconds: number;
		privateKey: CryptoKey;
		publicKey: CryptoKey;
	}) {
		this.issuer = options.issuer;
		this.audience = options.audience;
		this.ttlSeconds = options.ttlSeconds;
		this.privateKey = options.privateKey;
		this.publicKey = options.publicKey;
	}

	async issue(user: AuthUser, sessionId: string, now: Date): Promise<string> {
		const issuedAt = Math.floor(now.getTime() / 1000);
		return new SignJWT({ user_id: user.id, sid: sessionId, role: user.role })
			.setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
			.setIssuer(this.issuer)
			.setAudience(this.audience)
			.setJti(randomUUID())
			.setIssuedAt(issuedAt)
			.setExpirationTime(issuedAt + this.ttlSeconds)
			.sign(this.privateKey);
	}

	async verify(token: string, now: Date): Promise<VerifiedAccessToken> {
		const result = await jwtVerify(token, this.publicKey, {
			algorithms: ["EdDSA"],
			audience: this.audience,
			issuer: this.issuer,
			currentDate: now,
			typ: "JWT",
		});
		const { user_id: userId, sid: sessionId, jti, role } = result.payload;
		if (
			typeof userId !== "string" ||
			typeof sessionId !== "string" ||
			typeof jti !== "string" ||
			(role !== "user" && role !== "admin")
		) {
			throw new Error("Access token claims are invalid");
		}
		return { userId, sessionId, jti, role };
	}
}

export function createRefreshToken(sessionId: string = randomUUID()): RefreshTokenParts {
	const token = `${sessionId}.${randomBytes(32).toString("base64url")}`;
	return { sessionId, token, hash: hashOpaqueToken(token) };
}

export function parseRefreshToken(token: string): RefreshTokenParts | null {
	const separator = token.indexOf(".");
	if (separator <= 0 || token.indexOf(".", separator + 1) !== -1) return null;
	const sessionId = token.slice(0, separator);
	const secret = token.slice(separator + 1);
	if (!/^[0-9a-f-]{36}$/iu.test(sessionId) || !/^[A-Za-z0-9_-]{43}$/u.test(secret)) return null;
	return { sessionId, token, hash: hashOpaqueToken(token) };
}

export function hashOpaqueToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("base64url");
}
