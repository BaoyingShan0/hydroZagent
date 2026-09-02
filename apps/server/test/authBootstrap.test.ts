import { describe, expect, it } from "vitest";
import { readAuthBootstrapConfig } from "../src/auth/bootstrap.js";

function completeEnvironment(): NodeJS.ProcessEnv {
	return {
		HCS_DATABASE_URL: "postgresql://localhost/hcs",
		HCS_JWT_ISSUER: "https://hcs.test",
		HCS_JWT_AUDIENCE: "hydrozagent-managed",
		HCS_JWT_PRIVATE_KEY_PEM: "private-key-fixture",
		HCS_JWT_PUBLIC_KEY_PEM: "public-key-fixture",
		HCS_ACCESS_TTL_SECONDS: "300",
		HCS_REFRESH_TTL_SECONDS: "3600",
		HCS_LOGIN_WINDOW_SECONDS: "60",
		HCS_LOGIN_ATTEMPTS_PER_WINDOW: "10",
		HCS_REGISTRATION_WINDOW_SECONDS: "60",
		HCS_REGISTRATIONS_PER_WINDOW: "3",
		HCS_FAILED_LOGIN_THRESHOLD: "5",
		HCS_LOCK_SECONDS: "300",
		HCS_ARGON2_ITERATIONS: "2",
		HCS_ARGON2_PARALLELISM: "1",
		HCS_ARGON2_MEMORY_KIB: "19456",
		HCS_ARGON2_HASH_LENGTH: "32",
	};
}

describe("auth bootstrap configuration", () => {
	it("reports every missing production decision instead of guessing defaults", () => {
		const loaded = readAuthBootstrapConfig({});

		expect(loaded.config).toBeNull();
		expect(loaded.missing).toContain("HCS_ACCESS_TTL_SECONDS");
		expect(loaded.missing).toContain("HCS_JWT_PRIVATE_KEY_PEM");
		expect(loaded.missing).toContain("HCS_ARGON2_MEMORY_KIB");
	});

	it("parses a fully explicit policy", () => {
		const loaded = readAuthBootstrapConfig(completeEnvironment());

		expect(loaded.missing).toEqual([]);
		expect(loaded.config?.policy).toMatchObject({ accessTtlSeconds: 300, refreshTtlSeconds: 3600 });
		expect(loaded.config?.argon2id).toEqual({
			iterations: 2,
			parallelism: 1,
			memorySizeKiB: 19456,
			hashLength: 32,
		});
	});

	it("rejects invalid numeric policy instead of falling back", () => {
		const environment = completeEnvironment();
		environment.HCS_ACCESS_TTL_SECONDS = "0";

		expect(() => readAuthBootstrapConfig(environment)).toThrow(/HCS_ACCESS_TTL_SECONDS must be/u);
	});
});
