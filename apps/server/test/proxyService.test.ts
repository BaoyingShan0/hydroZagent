import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedPrincipal } from "../src/auth/types.js";
import { parseModelCatalog } from "../src/proxy/modelCatalog.js";
import { ManagedProxyService } from "../src/proxy/proxyService.js";
import { InMemoryProxyCallRepository } from "./support/inMemoryProxyCallRepository.js";

const PRINCIPAL: AuthenticatedPrincipal = {
	userId: "00000000-0000-4000-8000-000000000001",
	sessionId: "00000000-0000-4000-8000-000000000002",
	role: "user",
	username: "alice",
};

const received: Array<{ authorization: string | undefined; body: string }> = [];
let server: Server;
let baseUrl: string;

async function readRequest(request: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return Buffer.concat(chunks).toString("utf8");
}

async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const body = await readRequest(request);
	received.push({ authorization: request.headers.authorization, body });
	const parsed: unknown = JSON.parse(body);
	const streaming = typeof parsed === "object" && parsed !== null && "stream" in parsed && parsed.stream === true;
	if (streaming) {
		response.writeHead(200, { "content-type": "text/event-stream" });
		response.write('data: {"choices":[{"delta":{"tool_calls":[{"id":"tool-1"}]}}]}\n\n');
		response.end('data: {"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\ndata: [DONE]\n\n');
		return;
	}
	response.writeHead(200, { "content-type": "application/json" });
	response.end('{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}');
}

function catalog(expiresAt = "2099-01-01T00:00:00.000Z") {
	return parseModelCatalog(
		JSON.stringify({
			catalog_version: "catalog-1",
			expires_at: expiresAt,
			models: [
				{
					managed_model: {
						id: "managed-coder",
						name: "Managed Coder",
						provider: "hydro-managed",
						contextWindow: 128000,
						maxTokens: 8192,
						reasoning: true,
						input: ["text"],
						defaultThinkingLevel: "medium",
					},
					upstream_model: "private/upstream-coder",
				},
			],
		}),
	);
}

function makeService(
	repository: InMemoryProxyCallRepository,
	options: { expiresAt?: string; requestsPerMinute?: number; globalConcurrency?: number } = {},
): ManagedProxyService {
	return new ManagedProxyService({
		catalog: catalog(options.expiresAt),
		repository,
		upstreamBaseUrl: baseUrl,
		upstreamApiKey: "server-only-secret",
		requestTimeoutMilliseconds: 5_000,
		maximumResponseBytes: 64 * 1024,
		requestsPerMinute: options.requestsPerMinute ?? 10,
		globalConcurrency: options.globalConcurrency ?? 2,
	});
}

beforeEach(async () => {
	received.length = 0;
	server = createServer((request, response) => void handler(request, response));
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Fake upstream did not bind an IPv4 port");
	baseUrl = `http://127.0.0.1:${address.port}/`;
});

afterEach(async () => {
	server.close();
	await once(server, "close");
});

describe("ManagedProxyService", () => {
	it("uses only the server credential, maps the private model, and settles JSON usage", async () => {
		const repository = new InMemoryProxyCallRepository();
		const service = makeService(repository);
		const response = await service.forward(
			{ model: "managed-coder", messages: [{ role: "user", content: "secret body" }] },
			PRINCIPAL,
			new Date("2026-09-01T00:00:00.000Z"),
		);

		expect(response.kind).toBe("buffer");
		expect(received).toHaveLength(1);
		expect(received[0]?.authorization).toBe("Bearer server-only-secret");
		expect(JSON.parse(received[0]?.body ?? "{}")).toMatchObject({ model: "private/upstream-coder" });
		expect(repository.calls[0]).toMatchObject({ userId: PRINCIPAL.userId, model: "managed-coder" });
		expect(repository.calls[0]?.settlement).toMatchObject({
			status: "completed",
			promptTokens: 5,
			completionTokens: 2,
			errorCode: null,
		});
	});

	it("passes SSE tool frames through and settles streamed usage", async () => {
		const repository = new InMemoryProxyCallRepository();
		const response = await makeService(repository).forward(
			{ model: "managed-coder", messages: [{ role: "user" }], stream: true },
			PRINCIPAL,
			new Date("2026-09-01T00:00:00.000Z"),
		);
		if (response.kind !== "stream") throw new Error("Expected a streaming response");
		const bytes = new Uint8Array(await new Response(response.body).arrayBuffer());
		expect(new TextDecoder().decode(bytes)).toContain('"tool_calls"');
		await response.complete(bytes);
		expect(repository.calls[0]?.settlement).toMatchObject({
			status: "completed",
			promptTokens: 7,
			completionTokens: 3,
		});
	});

	it("fails closed for an expired catalog and a non-whitelisted model before upstream I/O", async () => {
		const expiredRepository = new InMemoryProxyCallRepository();
		const expired = makeService(expiredRepository, { expiresAt: "2020-01-01T00:00:00.000Z" });
		await expect(
			expired.forward({ model: "managed-coder", messages: [{}] }, PRINCIPAL, new Date("2026-09-01T00:00:00.000Z")),
		).rejects.toMatchObject({ code: "catalog_unavailable" });

		const currentRepository = new InMemoryProxyCallRepository();
		await expect(
			makeService(currentRepository).forward({ model: "forged-model", messages: [{}] }, PRINCIPAL, new Date()),
		).rejects.toMatchObject({ code: "model_not_allowed" });
		expect(received).toHaveLength(0);
		expect(expiredRepository.calls).toHaveLength(0);
		expect(currentRepository.calls).toHaveLength(0);
	});

	it("releases global concurrency when a stream is cancelled", async () => {
		const repository = new InMemoryProxyCallRepository();
		const service = makeService(repository, { globalConcurrency: 1 });
		const first = await service.forward(
			{ model: "managed-coder", messages: [{}], stream: true },
			PRINCIPAL,
			new Date("2026-09-01T00:00:00.000Z"),
		);
		await expect(
			service.forward({ model: "managed-coder", messages: [{}] }, PRINCIPAL, new Date("2026-09-01T00:00:01.000Z")),
		).rejects.toMatchObject({ code: "rate_limited" });
		if (first.kind !== "stream") throw new Error("Expected a streaming response");
		await first.cancel();
		const second = await service.forward(
			{ model: "managed-coder", messages: [{}] },
			PRINCIPAL,
			new Date("2026-09-01T00:00:02.000Z"),
		);
		expect(second.kind).toBe("buffer");
		expect(repository.calls[0]?.settlement?.status).toBe("cancelled");
	});

	it("enforces the per-user request quota with retry metadata", async () => {
		const repository = new InMemoryProxyCallRepository();
		const service = makeService(repository, { requestsPerMinute: 1 });
		await service.forward({ model: "managed-coder", messages: [{}] }, PRINCIPAL, new Date("2026-09-01T00:00:00.000Z"));
		await expect(
			service.forward({ model: "managed-coder", messages: [{}] }, PRINCIPAL, new Date("2026-09-01T00:00:01.000Z")),
		).rejects.toMatchObject({ code: "quota_exceeded", retryAfterSeconds: 59 });
	});
});
