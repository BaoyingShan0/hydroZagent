import Fastify, { type FastifyInstance } from "fastify";
import type { AuthService } from "./auth/authService.js";
import { HcsRequestError } from "./auth/errors.js";
import { registerAuthRoutes } from "./auth/routes.js";
import type { AppRuntimeConfig } from "./config/runtimeConfig.js";
import type { ConsentService } from "./consent/consentService.js";
import { registerConsentRoutes } from "./consent/routes.js";
import { contractSchemaRef, registerContractSchema } from "./contracts/registry.js";
import type { ManagedProxyService } from "./proxy/proxyService.js";
import { registerProxyRoutes } from "./proxy/routes.js";
import type { UsageService } from "./usage/usageService.js";
import { registerUsageRoutes } from "./usage/routes.js";

const SERVICE_NAME = "hydro-control-server";

export type AppServices = {
	auth?: AuthService;
	consent?: ConsentService;
	proxy?: ManagedProxyService;
	proxyMaximumResponseBytes?: number;
	usage?: UsageService;
	usageMaximumPayloadBytes?: number;
	readiness?: () => Promise<string[]>;
};

function hasErrorCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/** Builds the HCS HTTP application without opening a socket so routes remain injectable in tests. */
export function buildApp(config: AppRuntimeConfig, services: AppServices = {}): FastifyInstance {
	const app = Fastify({
		// Preserve the wire contract: coercion makes nullable oneOf fields ambiguous.
		ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
		bodyLimit: 1024 * 1024,
		logger: config.environment !== "test",
		requestIdHeader: false,
		...(config.https ? { https: config.https } : {}),
	});
	registerContractSchema(app);

	app.setErrorHandler((error, _request, reply) => {
		if (error instanceof HcsRequestError) {
			if (error.retryAfterSeconds !== undefined) reply.header("Retry-After", error.retryAfterSeconds);
			return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
		}
		if (hasErrorCode(error, "FST_ERR_VALIDATION")) {
			return reply.code(400).send({ error: { code: "invalid_request", message: "请求字段不符合契约" } });
		}
		if (hasErrorCode(error, "FST_ERR_CTP_BODY_TOO_LARGE")) {
			return reply.code(413).send({ error: { code: "payload_too_large", message: "请求体超过大小限制" } });
		}
		app.log.error({ err: error }, "Unhandled HCS request error");
		return reply.code(500).send({ error: { code: "upstream_error", message: "服务暂时不可用" } });
	});

	app.get(
		"/healthz",
		{
			schema: {
				response: {
					200: contractSchemaRef("HealthResponse"),
				},
			},
		},
		async () => ({ status: "ok", service: SERVICE_NAME }),
	);

	app.get(
		"/readyz",
		{
			schema: {
				response: {
					200: contractSchemaRef("HealthResponse"),
					503: contractSchemaRef("HealthResponse"),
				},
			},
		},
		async (_request, reply) => {
			const issues = services.readiness ? await services.readiness() : ["runtime_services_missing"];
			if (issues.length > 0) return reply.code(503).send({ status: "not_ready", service: SERVICE_NAME });
			return reply.code(200).send({ status: "ready", service: SERVICE_NAME });
		},
	);

	if (services.auth) registerAuthRoutes(app, services.auth);
	if (services.auth && services.consent) registerConsentRoutes(app, services.auth, services.consent);
	if (services.auth && services.consent && services.proxy && services.proxyMaximumResponseBytes) {
		registerProxyRoutes(app, {
			auth: services.auth,
			consent: services.consent,
			proxy: services.proxy,
			maximumCaptureBytes: services.proxyMaximumResponseBytes,
		});
	}
	if (services.auth && services.consent && services.usage && services.usageMaximumPayloadBytes) {
		registerUsageRoutes(app, {
			auth: services.auth,
			consent: services.consent,
			usage: services.usage,
			maximumPayloadBytes: services.usageMaximumPayloadBytes,
		});
	}

	return app;
}
