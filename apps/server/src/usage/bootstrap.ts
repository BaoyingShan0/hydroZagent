import type { Pool } from "pg";
import { parseUsageKeyring } from "./encryption.js";
import { PgUsageRepository } from "./pgUsageRepository.js";
import { UsageService } from "./usageService.js";

export type UsageBootstrapResult = {
	usage: UsageService | undefined;
	maximumPayloadBytes: number;
	readiness: () => Promise<string[]>;
};

const REQUIRED_SETTINGS = ["HCS_USAGE_KEYRING_JSON", "HCS_USAGE_FINGERPRINT_KEY", "HCS_INGEST_MAX_PAYLOAD_BYTES"] as const;

export function bootstrapUsage(pool: Pool | undefined, environment: NodeJS.ProcessEnv): UsageBootstrapResult {
	const missing: string[] = REQUIRED_SETTINGS.filter((name) => !environment[name]);
	if (!pool) missing.push("HCS_DATABASE_URL");
	if (missing.length > 0) {
		return {
			usage: undefined,
			maximumPayloadBytes: 0,
			readiness: async () => missing.map((name) => `missing:${name}`),
		};
	}
	const keyringJson = environment.HCS_USAGE_KEYRING_JSON;
	const fingerprintKey = environment.HCS_USAGE_FINGERPRINT_KEY;
	const maximumPayloadBytes = Number(environment.HCS_INGEST_MAX_PAYLOAD_BYTES);
	if (!pool || !keyringJson || !fingerprintKey || !Number.isSafeInteger(maximumPayloadBytes) || maximumPayloadBytes < 1) {
		return { usage: undefined, maximumPayloadBytes: 0, readiness: async () => ["usage_configuration_invalid"] };
	}
	try {
		return {
			usage: new UsageService({
				repository: new PgUsageRepository(pool),
				keyring: parseUsageKeyring(keyringJson, fingerprintKey),
				maximumPayloadBytes,
			}),
			maximumPayloadBytes,
			readiness: async () => [],
		};
	} catch {
		return { usage: undefined, maximumPayloadBytes: 0, readiness: async () => ["usage_bootstrap_failed"] };
	}
}
