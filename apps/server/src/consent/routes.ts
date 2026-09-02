import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/access.js";
import type { AuthService } from "../auth/authService.js";
import type { ConsentRequest } from "../contracts/generated.js";
import { contractSchemaRef } from "../contracts/registry.js";
import type { ConsentService } from "./consentService.js";

export function registerConsentRoutes(app: FastifyInstance, auth: AuthService, consent: ConsentService): void {
	app.get(
		"/auth/notice",
		{ schema: { response: { 200: contractSchemaRef("NoticeResponse") } } },
		async () => consent.notice,
	);

	app.post<{ Body: ConsentRequest }>(
		"/auth/consent",
		{
			schema: {
				body: contractSchemaRef("ConsentRequest"),
				response: {
					200: contractSchemaRef("AcceptedResponse"),
					401: contractSchemaRef("ErrorResponse"),
					403: contractSchemaRef("ErrorResponse"),
				},
			},
		},
		async (request) => {
			const now = new Date();
			const principal = await authenticateRequest(request, auth, now);
			await consent.consent(principal.userId, request.body.notice_version, request.body.client_version, now);
			return { accepted: true };
		},
	);

	app.post(
		"/auth/withdraw-consent",
		{
			schema: {
				response: {
					200: contractSchemaRef("AcceptedResponse"),
					401: contractSchemaRef("ErrorResponse"),
				},
			},
		},
		async (request) => {
			const now = new Date();
			const principal = await authenticateRequest(request, auth, now);
			await consent.withdraw(principal.userId, now);
			return { accepted: true };
		},
	);
}
