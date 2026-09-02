import { randomUUID } from "node:crypto";
import { HcsRequestError } from "../auth/errors.js";
import { InMemoryRateLimiter } from "../auth/rateLimiter.js";
import type { AuthenticatedPrincipal } from "../auth/types.js";
import type { ManagedChatCompletionsRequest } from "../contracts/generated.js";
import { ConcurrencyGate } from "./concurrency.js";
import type { ModelCatalog } from "./modelCatalog.js";
import type { ModelCallSettlement, ProxyCallRepository } from "./repository.js";

type TokenUsage = {
	promptTokens: number | null;
	completionTokens: number | null;
};

export type BufferedProxyResponse = {
	kind: "buffer";
	callId: string;
	statusCode: number;
	contentType: string;
	body: Uint8Array;
};

export type StreamingProxyResponse = {
	kind: "stream";
	callId: string;
	statusCode: number;
	contentType: string;
	body: ReadableStream<Uint8Array>;
	complete: (capturedBytes: Uint8Array) => Promise<void>;
	cancel: () => Promise<void>;
	fail: () => Promise<void>;
};

export type ManagedProxyResponse = BufferedProxyResponse | StreamingProxyResponse;

type ProxyServiceOptions = {
	catalog: ModelCatalog;
	repository: ProxyCallRepository;
	upstreamBaseUrl: string;
	upstreamApiKey: string;
	requestTimeoutMilliseconds: number;
	maximumResponseBytes: number;
	requestsPerMinute: number;
	globalConcurrency: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integerToken(value: unknown): number | null {
	return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function usageFromJson(value: unknown): TokenUsage {
	if (!isRecord(value) || !isRecord(value.usage)) return { promptTokens: null, completionTokens: null };
	return {
		promptTokens: integerToken(value.usage.prompt_tokens),
		completionTokens: integerToken(value.usage.completion_tokens),
	};
}

function parseJsonUsage(bytes: Uint8Array): TokenUsage {
	try {
		return usageFromJson(JSON.parse(new TextDecoder().decode(bytes)));
	} catch {
		return { promptTokens: null, completionTokens: null };
	}
}

function parseSseUsage(bytes: Uint8Array): TokenUsage {
	let latest: TokenUsage = { promptTokens: null, completionTokens: null };
	for (const line of new TextDecoder().decode(bytes).split(/\r?\n/u)) {
		if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
		try {
			const usage = usageFromJson(JSON.parse(line.slice("data: ".length)));
			if (usage.promptTokens !== null || usage.completionTokens !== null) latest = usage;
		} catch {
			// Partial frames are ignored; proxy settlement remains valid with null token counts.
		}
	}
	return latest;
}

async function readBodyLimited(response: Response, maximumBytes: number): Promise<Uint8Array> {
	if (!response.body) return new Uint8Array();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	while (true) {
		const result = await reader.read();
		if (result.done) break;
		length += result.value.byteLength;
		if (length > maximumBytes) {
			await reader.cancel();
			throw new HcsRequestError("upstream_error", 502, "上游响应超过安全大小限制");
		}
		chunks.push(result.value);
	}
	const body = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

export class ManagedProxyService {
	readonly catalog: ModelCatalog;
	private readonly repository: ProxyCallRepository;
	private readonly upstreamUrl: URL;
	private readonly upstreamApiKey: string;
	private readonly requestTimeoutMilliseconds: number;
	private readonly maximumResponseBytes: number;
	private readonly userLimiter: InMemoryRateLimiter;
	private readonly concurrency: ConcurrencyGate;

	constructor(options: ProxyServiceOptions) {
		this.catalog = options.catalog;
		this.repository = options.repository;
		const baseUrl = new URL(options.upstreamBaseUrl);
		if (baseUrl.username || baseUrl.password) throw new Error("Model upstream URL must not contain credentials");
		this.upstreamUrl = new URL("chat/completions", options.upstreamBaseUrl.endsWith("/") ? options.upstreamBaseUrl : `${options.upstreamBaseUrl}/`);
		if (this.upstreamUrl.protocol !== "https:" && this.upstreamUrl.hostname !== "127.0.0.1" && this.upstreamUrl.hostname !== "localhost") {
			throw new Error("Model upstream must use HTTPS outside loopback tests");
		}
		if (!options.upstreamApiKey) throw new Error("Model upstream API key is required");
		this.upstreamApiKey = options.upstreamApiKey;
		this.requestTimeoutMilliseconds = options.requestTimeoutMilliseconds;
		this.maximumResponseBytes = options.maximumResponseBytes;
		this.userLimiter = new InMemoryRateLimiter(options.requestsPerMinute, 60);
		this.concurrency = new ConcurrencyGate(options.globalConcurrency);
	}

	async forward(
		body: ManagedChatCompletionsRequest,
		principal: AuthenticatedPrincipal,
		now: Date,
	): Promise<ManagedProxyResponse> {
		const quota = this.userLimiter.consume(principal.userId, now);
		if (!quota.allowed) throw new HcsRequestError("quota_exceeded", 429, "用户模型调用配额已用尽", quota.retryAfterSeconds);
		const resolved = this.catalog.resolve(body.model, now);
		const release = this.concurrency.tryAcquire();
		if (!release) throw new HcsRequestError("rate_limited", 429, "模型代理当前并发已满", 1);
		const callId = randomUUID();
		try {
			await this.repository.start({ id: callId, userId: principal.userId, model: body.model, startedAt: now });
		} catch {
			release();
			throw new HcsRequestError("upstream_error", 503, "模型调用记录不可用");
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(new Error("upstream timeout")), this.requestTimeoutMilliseconds);
		let settled = false;
		const settle = async (status: ModelCallSettlement["status"], errorCode: string | null, usage: TokenUsage): Promise<void> => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			release();
			const endedAt = new Date();
			await this.repository.settle(callId, {
				status,
				endedAt,
				errorCode,
				promptTokens: usage.promptTokens,
				completionTokens: usage.completionTokens,
				latencyMs: Math.max(0, endedAt.getTime() - now.getTime()),
			});
		};

		let response: Response;
		try {
			response = await fetch(this.upstreamUrl, {
				method: "POST",
				headers: {
					accept: body.stream === true ? "text/event-stream" : "application/json",
					authorization: `Bearer ${this.upstreamApiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ ...body, model: resolved.upstreamModel }),
				redirect: "error",
				signal: controller.signal,
			});
		} catch {
			await settle("error", "upstream_error", { promptTokens: null, completionTokens: null });
			throw new HcsRequestError("upstream_error", 502, "模型服务不可用");
		}

		if (!response.ok || !response.body) {
			await response.body?.cancel();
			await settle("error", "upstream_error", { promptTokens: null, completionTokens: null });
			throw new HcsRequestError("upstream_error", 502, "模型服务返回错误");
		}
		const contentType = response.headers.get("content-type") ?? (body.stream === true ? "text/event-stream" : "application/json");
		if (body.stream === true) {
			return {
				kind: "stream",
				callId,
				statusCode: response.status,
				contentType,
				body: response.body,
				complete: async (capturedBytes) => settle("completed", null, parseSseUsage(capturedBytes)),
				cancel: async () => {
					controller.abort(new Error("client cancelled"));
					await settle("cancelled", null, { promptTokens: null, completionTokens: null });
				},
				fail: async () => {
					controller.abort(new Error("stream failed"));
					await settle("error", "upstream_error", { promptTokens: null, completionTokens: null });
				},
			};
		}

		try {
			const responseBody = await readBodyLimited(response, this.maximumResponseBytes);
			await settle("completed", null, parseJsonUsage(responseBody));
			return { kind: "buffer", callId, statusCode: response.status, contentType, body: responseBody };
		} catch (error: unknown) {
			await settle("error", "upstream_error", { promptTokens: null, completionTokens: null });
			throw error;
		}
	}
}
