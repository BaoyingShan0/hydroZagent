import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/access.js";
import type { AuthService } from "../auth/authService.js";
import type { ConsentService } from "../consent/consentService.js";
import type { UsageIngestRequest } from "../contracts/generated.js";
import { contractSchemaRef } from "../contracts/registry.js";
import type { UsageService } from "./usageService.js";

export function registerUsageRoutes(
	app: FastifyInstance,
	services: {
		auth: AuthService;
		consent: ConsentService;
		usage: UsageService;
		maximumPayloadBytes: number;
	},
): void {
	app.post<{ Body: UsageIngestRequest }>(
		"/ingest/usage",
		{
			bodyLimit: services.maximumPayloadBytes,
			schema: {
				body: contractSchemaRef("UsageIngestRequest"),
				response: {
					200: contractSchemaRef("UsageIngestResponse"),
					400: contractSchemaRef("ErrorResponse"),
					401: contractSchemaRef("ErrorResponse"),
					403: contractSchemaRef("ErrorResponse"),
					413: contractSchemaRef("ErrorResponse"),
				},
			},
		},
		async (request) => {
			const now = new Date();
			const principal = await authenticateRequest(request, services.auth, now);
			await services.consent.assertValidConsent(principal.userId);
			return services.usage.ingest(request.body, principal.userId, now);
		},
	);
}
