import { importPKCS8, importSPKI } from "jose";
import type { Pool } from "pg";
import { createDatabasePool } from "../db/pool.js";
import { createAuthService } from "./authService.js";
import { PasswordHasher, type Argon2idParameters } from "./passwordHasher.js";
import { PgAuthRepository } from "./pgAuthRepository.js";
import { AccessTokenService } from "./tokenService.js";
import type { AuthPolicy } from "./types.js";
import type { AuthService } from "./authService.js";

type AuthBootstrapConfig = {
	databaseUrl: string;
	issuer: string;
	audience: string;
	privateKeyPem: string;
	publicKeyPem: string;
	policy: AuthPolicy;
	argon2id: Argon2idParameters;
};

export type AuthBootstrapResult = {
	auth: AuthService | undefined;
	pool: Pool | undefined;
	readiness: () => Promise<string[]>;
	close: () => Promise<void>;
};

const REQUIRED_SETTINGS = [
	"HCS_DATABASE_URL",
	"HCS_JWT_ISSUER",
	"HCS_JWT_AUDIENCE",
	"HCS_JWT_PRIVATE_KEY_PEM",
	"HCS_JWT_PUBLIC_KEY_PEM",
	"HCS_ACCESS_TTL_SECONDS",
	"HCS_REFRESH_TTL_SECONDS",
	"HCS_LOGIN_WINDOW_SECONDS",
	"HCS_LOGIN_ATTEMPTS_PER_WINDOW",
	"HCS_REGISTRATION_WINDOW_SECONDS",
	"HCS_REGISTRATIONS_PER_WINDOW",
	"HCS_FAILED_LOGIN_THRESHOLD",
	"HCS_LOCK_SECONDS",
	"HCS_ARGON2_ITERATIONS",
	"HCS_ARGON2_PARALLELISM",
	"HCS_ARGON2_MEMORY_KIB",
	"HCS_ARGON2_HASH_LENGTH",
] as const;

function positiveInteger(environment: NodeJS.ProcessEnv, name: (typeof REQUIRED_SETTINGS)[number]): number {
	const value = Number(environment[name]);
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
	return value;
}

export function readAuthBootstrapConfig(
	environment: NodeJS.ProcessEnv,
): { config: AuthBootstrapConfig | null; missing: string[] } {
	const missing = REQUIRED_SETTINGS.filter((name) => !environment[name]);
	if (missing.length > 0) return { config: null, missing: [...missing] };
	const databaseUrl = environment.HCS_DATABASE_URL;
	const issuer = environment.HCS_JWT_ISSUER;
	const audience = environment.HCS_JWT_AUDIENCE;
	const privateKeyPem = environment.HCS_JWT_PRIVATE_KEY_PEM;
	const publicKeyPem = environment.HCS_JWT_PUBLIC_KEY_PEM;
	if (!databaseUrl || !issuer || !audience || !privateKeyPem || !publicKeyPem) {
		throw new Error("Auth bootstrap invariant failed after required setting validation");
	}
	return {
		missing: [],
		config: {
			databaseUrl,
			issuer,
			audience,
			privateKeyPem,
			publicKeyPem,
			policy: {
				accessTtlSeconds: positiveInteger(environment, "HCS_ACCESS_TTL_SECONDS"),
				refreshTtlSeconds: positiveInteger(environment, "HCS_REFRESH_TTL_SECONDS"),
				loginWindowSeconds: positiveInteger(environment, "HCS_LOGIN_WINDOW_SECONDS"),
				loginAttemptsPerWindow: positiveInteger(environment, "HCS_LOGIN_ATTEMPTS_PER_WINDOW"),
				registrationWindowSeconds: positiveInteger(environment, "HCS_REGISTRATION_WINDOW_SECONDS"),
				registrationsPerWindow: positiveInteger(environment, "HCS_REGISTRATIONS_PER_WINDOW"),
				failedLoginThreshold: positiveInteger(environment, "HCS_FAILED_LOGIN_THRESHOLD"),
				lockSeconds: positiveInteger(environment, "HCS_LOCK_SECONDS"),
			},
			argon2id: {
				iterations: positiveInteger(environment, "HCS_ARGON2_ITERATIONS"),
				parallelism: positiveInteger(environment, "HCS_ARGON2_PARALLELISM"),
				memorySizeKiB: positiveInteger(environment, "HCS_ARGON2_MEMORY_KIB"),
				hashLength: positiveInteger(environment, "HCS_ARGON2_HASH_LENGTH"),
			},
		},
	};
}

async function databaseReadiness(pool: Pool): Promise<string[]> {
	try {
		const result = await pool.query<{
			users: string | null;
			auth_sessions: string | null;
			admin_audit: string | null;
		}>("SELECT to_regclass('users') AS users, to_regclass('auth_sessions') AS auth_sessions, to_regclass('admin_audit') AS admin_audit");
		const row = result.rows[0];
		return row?.users && row.auth_sessions && row.admin_audit ? [] : ["database_schema_incomplete"];
	} catch {
		return ["database_unavailable"];
	}
}

/** Creates auth only when every production value exists; partial configuration stays fail-closed. */
export async function bootstrapAuth(environment: NodeJS.ProcessEnv): Promise<AuthBootstrapResult> {
	const loaded = readAuthBootstrapConfig(environment);
	if (!loaded.config) {
		const issues = loaded.missing.map((name) => `missing:${name}`);
		return { auth: undefined, pool: undefined, readiness: async () => issues, close: async () => undefined };
	}

	let pool: Pool | undefined;
	try {
		const privateKey = await importPKCS8(loaded.config.privateKeyPem, "EdDSA");
		const publicKey = await importSPKI(loaded.config.publicKeyPem, "EdDSA");
		const databasePool = createDatabasePool(loaded.config.databaseUrl);
		pool = databasePool;
		const repository = new PgAuthRepository(databasePool);
		const passwordHasher = new PasswordHasher(loaded.config.argon2id);
		const auth = await createAuthService({
			repository,
			passwordHasher,
			accessTokens: new AccessTokenService({
				issuer: loaded.config.issuer,
				audience: loaded.config.audience,
				ttlSeconds: loaded.config.policy.accessTtlSeconds,
				privateKey,
				publicKey,
			}),
			policy: loaded.config.policy,
		});
		return {
			auth,
			pool: databasePool,
			readiness: async () => databaseReadiness(databasePool),
			close: async () => databasePool.end(),
		};
	} catch {
		await pool?.end();
		return {
			auth: undefined,
			pool: undefined,
			readiness: async () => ["auth_bootstrap_failed"],
			close: async () => undefined,
		};
	}
}
