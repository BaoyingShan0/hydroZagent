import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { bootstrapProxy } from "../src/proxy/bootstrap.js";

const CATALOG = JSON.stringify({
	catalog_version: "v1",
	expires_at: "2099-01-01T00:00:00.000Z",
	models: [{
		managed_model: {
			id: "managed-model",
			name: "Managed Model",
			provider: "hydro-managed",
			contextWindow: 128000,
			maxTokens: 8192,
			reasoning: false,
			input: ["text"],
		},
		upstream_model: "private-model",
	}],
});

function environment(baseUrl: string, healthUrl: string): NodeJS.ProcessEnv {
	return {
		HCS_MODEL_CATALOG_JSON: CATALOG,
		HCS_UPSTREAM_BASE_URL: baseUrl,
		HCS_UPSTREAM_HEALTH_URL: healthUrl,
		HCS_UPSTREAM_API_KEY: "server-only-key",
		HCS_PROXY_TIMEOUT_MS: "30000",
		HCS_PROXY_MAX_RESPONSE_BYTES: "1048576",
		HCS_PROXY_USER_REQUESTS_PER_MINUTE: "60",
		HCS_PROXY_GLOBAL_CONCURRENCY: "8",
	};
}

describe("proxy bootstrap endpoint boundary", () => {
	it("accepts a health path on the exact configured model origin", () => {
		const result = bootstrapProxy({} as Pool, environment("https://models.internal/v1", "https://models.internal/health"));

		expect(result.proxy).toBeDefined();
	});

	it("fails closed before sending the shared key to a cross-origin health endpoint", () => {
		const result = bootstrapProxy({} as Pool, environment("https://models.internal/v1", "https://observer.internal/health"));

		expect(result.proxy).toBeUndefined();
		expect(result.readiness()).resolves.toEqual(["proxy_configuration_invalid"]);
	});

	it("rejects URL-embedded credentials even on the configured model origin", () => {
		const result = bootstrapProxy({} as Pool, environment("https://user:secret@models.internal/v1", "https://models.internal/health"));

		expect(result.proxy).toBeUndefined();
		expect(result.readiness()).resolves.toEqual(["proxy_configuration_invalid"]);
	});
});
