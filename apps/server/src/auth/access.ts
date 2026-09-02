import type { FastifyRequest } from "fastify";
import { HcsRequestError } from "./errors.js";
import type { AuthService } from "./authService.js";
import type { AuthenticatedPrincipal } from "./types.js";

export function bearerToken(request: FastifyRequest): string {
	const authorization = request.headers.authorization;
	if (!authorization?.startsWith("Bearer ") || authorization.length <= "Bearer ".length) {
		throw new HcsRequestError("unauthorized", 401, "缺少访问令牌");
	}
	return authorization.slice("Bearer ".length);
}

export async function authenticateRequest(
	request: FastifyRequest,
	auth: AuthService,
	now = new Date(),
): Promise<AuthenticatedPrincipal> {
	return auth.authenticateAccess(bearerToken(request), now);
}
