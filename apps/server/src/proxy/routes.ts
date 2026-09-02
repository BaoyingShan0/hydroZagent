import { once } from "node:events";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticateRequest } from "../auth/access.js";
import type { AuthService } from "../auth/authService.js";
import { HcsRequestError } from "../auth/errors.js";
import type { ConsentService } from "../consent/consentService.js";
import { contractSchemaRef } from "../contracts/registry.js";
import type { ManagedChatCompletionsRequest } from "../contracts/generated.js";
import type { ManagedProxyService, StreamingProxyResponse } from "./proxyService.js";

async function relayStream(
	request: FastifyRequest,
	reply: FastifyReply,
	response: StreamingProxyResponse,
	maximumCaptureBytes: number,
): Promise<void> {
	reply.hijack();
	reply.raw.statusCode = response.statusCode;
	reply.raw.setHeader("content-type", response.contentType);
	reply.raw.setHeader("cache-control", "no-store");
	reply.raw.setHeader("x-hcs-model-call-id", response.callId);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let capturedLength = 0;
	let finished = false;
	const cancel = (): void => {
		if (finished) return;
		finished = true;
		void reader.cancel().catch(() => undefined);
		void response.cancel().catch((error: unknown) => request.log.error({ err: error }, "Failed to settle cancelled proxy call"));
	};
	request.raw.once("aborted", cancel);
	reply.raw.once("close", cancel);
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;
			capturedLength += result.value.byteLength;
			if (capturedLength > maximumCaptureBytes) {
				throw new HcsRequestError("upstream_error", 502, "流式响应超过安全大小限制");
			}
			chunks.push(result.value);
			if (!reply.raw.write(result.value)) await once(reply.raw, "drain");
		}
		finished = true;
		const captured = new Uint8Array(capturedLength);
		let offset = 0;
		for (const chunk of chunks) {
			captured.set(chunk, offset);
			offset += chunk.byteLength;
		}
		await response.complete(captured);
		reply.raw.end();
	} catch (error: unknown) {
		if (!finished) {
			finished = true;
			await reader.cancel().catch(() => undefined);
			await response.fail().catch((settlementError: unknown) =>
				request.log.error({ err: settlementError }, "Failed to settle failed proxy call"),
			);
		}
		if (!reply.raw.destroyed) reply.raw.destroy(error instanceof Error ? error : undefined);
	}
}

export function registerProxyRoutes(
	app: FastifyInstance,
	services: { auth: AuthService; consent: ConsentService; proxy: ManagedProxyService; maximumCaptureBytes: number },
): void {
	app.get(
		"/proxy/v1/models",
		{
			schema: {
				response: {
					200: contractSchemaRef("ManagedModelsResponse"),
					401: contractSchemaRef("ErrorResponse"),
					403: contractSchemaRef("ErrorResponse"),
					503: contractSchemaRef("ErrorResponse"),
				},
			},
		},
		async (request) => {
			const now = new Date();
			const principal = await authenticateRequest(request, services.auth, now);
			await services.consent.assertValidConsent(principal.userId);
			return {
				catalog_version: services.proxy.catalog.version,
				expires_at: services.proxy.catalog.expiresAt.toISOString(),
				models: services.proxy.catalog.models(now),
			};
		},
	);

	app.post<{ Body: ManagedChatCompletionsRequest }>(
		"/proxy/v1/chat/completions",
		{
			schema: {
				body: contractSchemaRef("ManagedChatCompletionsRequest"),
				response: {
					400: contractSchemaRef("ErrorResponse"),
					401: contractSchemaRef("ErrorResponse"),
					403: contractSchemaRef("ErrorResponse"),
					429: contractSchemaRef("ErrorResponse"),
					502: contractSchemaRef("ErrorResponse"),
					503: contractSchemaRef("ErrorResponse"),
				},
			},
		},
		async (request, reply) => {
			const now = new Date();
			const principal = await authenticateRequest(request, services.auth, now);
			await services.consent.assertValidConsent(principal.userId);
			const response = await services.proxy.forward(request.body, principal, now);
			if (response.kind === "buffer") {
				return reply
					.code(response.statusCode)
					.header("content-type", response.contentType)
					.header("cache-control", "no-store")
					.header("x-hcs-model-call-id", response.callId)
					.send(Buffer.from(response.body));
			}
			await relayStream(request, reply, response, services.maximumCaptureBytes);
			return reply;
		},
	);
}
