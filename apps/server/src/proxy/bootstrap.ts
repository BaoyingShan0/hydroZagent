import type { Pool } from "pg";
import { ModelCatalog, parseModelCatalog } from "./modelCatalog.js";
import { PgProxyCallRepository } from "./pgProxyCallRepository.js";
import { ManagedProxyService } from "./proxyService.js";

type ProxyBootstrapConfig = {
	catalog: ModelCatalog;
	upstreamBaseUrl: string;
	upstreamHealthUrl: string;
	upstreamApiKey: string;
	requestTimeoutMilliseconds: number;
	maximumResponseBytes: number;
	requestsPerMinute: number;
	globalConcurrency: number;
};

export type ProxyBootstrapResult = {
	proxy: ManagedProxyService | undefined;
	maximumResponseBytes: number;
	readiness: () => Promise<string[]>;
};

const REQUIRED_SETTINGS = [
	"HCS_MODEL_CATALOG_JSON",
	"HCS_UPSTREAM_BASE_URL",
	"HCS_UPSTREAM_HEALTH_URL",
	"HCS_UPSTREAM_API_KEY",
	"HCS_PROXY_TIMEOUT_MS",
	"HCS_PROXY_MAX_RESPONSE_BYTES",
	"HCS_PROXY_USER_REQUESTS_PER_MINUTE",
	"HCS_PROXY_GLOBAL_CONCURRENCY",
] as const;

function positiveInteger(environment: NodeJS.ProcessEnv, name: (typeof REQUIRED_SETTINGS)[number]): number {
	const value = Number(environment[name]);
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
	return value;
}

function loadConfig(environment: NodeJS.ProcessEnv): { config: ProxyBootstrapConfig | null; missing: string[] } {
	const missing = REQUIRED_SETTINGS.filter((name) => !environment[name]);
	if (missing.length > 0) return { config: null, missing: [...missing] };
	const catalogJson = environment.HCS_MODEL_CATALOG_JSON;
	const upstreamBaseUrl = environment.HCS_UPSTREAM_BASE_URL;
	const upstreamHealthUrl = environment.HCS_UPSTREAM_HEALTH_URL;
	const upstreamApiKey = environment.HCS_UPSTREAM_API_KEY;
	if (!catalogJson || !upstreamBaseUrl || !upstreamHealthUrl || !upstreamApiKey) {
		throw new Error("Proxy bootstrap invariant failed after required setting validation");
	}
	const baseUrl = safeUpstreamUrl(upstreamBaseUrl, "base");
	const healthUrl = safeUpstreamUrl(upstreamHealthUrl, "health");
	if (baseUrl.origin !== healthUrl.origin) {
		throw new Error("Model upstream health URL must share the model upstream origin");
	}
	return {
		missing: [],
		config: {
			catalog: parseModelCatalog(catalogJson),
			upstreamBaseUrl: baseUrl.toString(),
			upstreamHealthUrl: healthUrl.toString(),
			upstreamApiKey,
			requestTimeoutMilliseconds: positiveInteger(environment, "HCS_PROXY_TIMEOUT_MS"),
			maximumResponseBytes: positiveInteger(environment, "HCS_PROXY_MAX_RESPONSE_BYTES"),
			requestsPerMinute: positiveInteger(environment, "HCS_PROXY_USER_REQUESTS_PER_MINUTE"),
			globalConcurrency: positiveInteger(environment, "HCS_PROXY_GLOBAL_CONCURRENCY"),
		},
	};
}

function safeUpstreamUrl(source: string, purpose: "base" | "health"): URL {
	const url = new URL(source);
	if (url.username || url.password) throw new Error(`Model upstream ${purpose} URL must not contain credentials`);
	if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
		throw new Error(`Model upstream ${purpose} URL must use HTTPS outside loopback tests`);
	}
	return url;
}

async function checkUpstream(config: ProxyBootstrapConfig): Promise<string[]> {
	if (config.catalog.expiresAt.getTime() <= Date.now()) return ["model_catalog_expired"];
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), Math.min(config.requestTimeoutMilliseconds, 5_000));
	try {
		const response = await fetch(config.upstreamHealthUrl, {
			method: "GET",
			headers: { authorization: `Bearer ${config.upstreamApiKey}` },
			redirect: "error",
			signal: controller.signal,
		});
		await response.body?.cancel();
		return response.ok ? [] : ["model_upstream_unavailable"];
	} catch {
		return ["model_upstream_unavailable"];
	} finally {
		clearTimeout(timeout);
	}
}

export function bootstrapProxy(pool: Pool | undefined, environment: NodeJS.ProcessEnv): ProxyBootstrapResult {
	let loaded: ReturnType<typeof loadConfig>;
	try {
		loaded = loadConfig(environment);
	} catch {
		return { proxy: undefined, maximumResponseBytes: 0, readiness: async () => ["proxy_configuration_invalid"] };
	}
	const issues = loaded.missing.map((name) => `missing:${name}`);
	if (!pool) issues.push("database_unavailable");
	if (!loaded.config || !pool) return { proxy: undefined, maximumResponseBytes: 0, readiness: async () => issues };
	try {
		const config = loaded.config;
		const proxy = new ManagedProxyService({
			catalog: config.catalog,
			repository: new PgProxyCallRepository(pool),
			upstreamBaseUrl: config.upstreamBaseUrl,
			upstreamApiKey: config.upstreamApiKey,
			requestTimeoutMilliseconds: config.requestTimeoutMilliseconds,
			maximumResponseBytes: config.maximumResponseBytes,
			requestsPerMinute: config.requestsPerMinute,
			globalConcurrency: config.globalConcurrency,
		});
		return {
			proxy,
			maximumResponseBytes: config.maximumResponseBytes,
			readiness: async () => checkUpstream(config),
		};
	} catch {
		return { proxy: undefined, maximumResponseBytes: 0, readiness: async () => ["proxy_bootstrap_failed"] };
	}
}
