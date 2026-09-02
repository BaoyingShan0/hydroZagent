import type { FastifyInstance, FastifyRequest } from "fastify";
import { contractSchemaRef } from "../contracts/registry.js";
import { authenticateRequest } from "./access.js";
import { AuthService } from "./authService.js";
import type {
	LoginRequest,
	PasswordResetConfirmRequest,
	RefreshRequest,
	RegisterRequest,
} from "./types.js";

/** Registers only the P0 public account lifecycle; administrator operations remain local CLI-only. */
export function registerAuthRoutes(app: FastifyInstance, auth: AuthService): void {
	app.post<{ Body: RegisterRequest }>(
		"/auth/register",
		{
			schema: {
				body: contractSchemaRef("RegisterRequest"),
				response: {
					201: contractSchemaRef("AuthTokensResponse"),
					400: contractSchemaRef("ErrorResponse"),
					409: contractSchemaRef("ErrorResponse"),
					429: contractSchemaRef("ErrorResponse"),
				},
			},
		},
		async (request, reply) => {
			const response = await auth.register(request.body, { ip: request.ip, now: new Date() });
			return reply.code(201).send(response);
		},
	);

	app.post<{ Body: LoginRequest }>(
		"/auth/login",
		{
			schema: {
				body: contractSchemaRef("LoginRequest"),
				response: {
					200: contractSchemaRef("AuthTokensResponse"),
					401: contractSchemaRef("ErrorResponse"),
					403: contractSchemaRef("ErrorResponse"),
					423: contractSchemaRef("ErrorResponse"),
					429: contractSchemaRef("ErrorResponse"),
				},
			},
		},
		async (request) => auth.login(request.body, { ip: request.ip, now: new Date() }),
	);

	app.post<{ Body: RefreshRequest }>(
		"/auth/refresh",
		{
			schema: {
				body: contractSchemaRef("RefreshRequest"),
				response: {
					200: contractSchemaRef("AuthTokensResponse"),
					401: contractSchemaRef("ErrorResponse"),
				},
			},
		},
		async (request) => auth.refresh(request.body, new Date()),
	);

	app.post(
		"/auth/logout",
		{
			schema: {
				security: [{ bearerAuth: [] }],
				response: {
					200: contractSchemaRef("AcceptedResponse"),
					401: contractSchemaRef("ErrorResponse"),
				},
			},
		},
		async (request) => {
			const principal = await authenticateRequest(request, auth);
			await auth.logout(principal, new Date());
			return { accepted: true };
		},
	);

	app.post(
		"/auth/deactivate",
		{
			schema: {
				security: [{ bearerAuth: [] }],
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
			await auth.deactivate(principal, now);
			return { accepted: true };
		},
	);

	app.post<{ Body: PasswordResetConfirmRequest }>(
		"/auth/password-reset/confirm",
		{
			schema: {
				body: contractSchemaRef("PasswordResetConfirmRequest"),
				response: {
					200: contractSchemaRef("AcceptedResponse"),
					400: contractSchemaRef("ErrorResponse"),
					401: contractSchemaRef("ErrorResponse"),
				},
			},
		},
		async (request) => {
			await auth.confirmPasswordReset(request.body, new Date());
			return { accepted: true };
		},
	);
}
