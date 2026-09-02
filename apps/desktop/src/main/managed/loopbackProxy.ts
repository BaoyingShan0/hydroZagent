import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type {
	ConfigureManagedProviderCommand,
	ManagedModel,
} from "../../shared/hcsContracts.generated";
import type { ManagedAuthManager } from "./authManager";
import type { ManagedRuntimeLease } from "./runtimeRegistry";

const CHAT_PATH = "/proxy/v1/chat/completions";
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

function jsonError(response: ServerResponse, statusCode: number, code: string, message: string): void {
	if (response.headersSent || response.destroyed) return;
	const body = JSON.stringify({ error: { code, message } });
	response.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
		"cache-control": "no-store",
	});
	response.end(body);
}

function authorized(header: string | undefined, capability: string): boolean {
	if (!header) return false;
	const candidate = Buffer.from(header);
	const expected = Buffer.from(capability);
	return candidate.byteLength === expected.byteLength && timingSafeEqual(candidate, expected);
}

function collectBody(request: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let length = 0;
		request.on("data", (chunk: Buffer) => {
			length += chunk.byteLength;
			if (length > MAX_REQUEST_BYTES) {
				reject(new Error("payload_too_large"));
				request.destroy();
				return;
			}
			chunks.push(chunk);
		});
		request.once("error", reject);
		request.once("end", () => resolve(Buffer.concat(chunks)));
	});
}

export class ManagedLoopbackLease implements ManagedRuntimeLease {
	readonly runtimeId = randomUUID();
	readonly sessionId: string;
	private readonly auth: ManagedAuthManager;
	private readonly catalogVersion: string;
	private readonly models: ManagedModel[];
	private readonly hcsBaseUrl: string;
	private readonly caBundle: string;
	private readonly capability = randomBytes(32).toString("base64url");
	private readonly callIds = new Map<string, Set<string>>();
	private activeTurnId: string | null = null;
	private server: Server | null = null;
	private port = 0;
	private closing: Promise<void> | null = null;

	constructor(options: {
		sessionId: string;
		auth: ManagedAuthManager;
		catalogVersion: string;
		models: ManagedModel[];
		hcsBaseUrl: string;
		caBundle: string;
	}) {
		this.sessionId = options.sessionId;
		this.auth = options.auth;
		this.catalogVersion = options.catalogVersion;
		this.models = options.models;
		this.hcsBaseUrl = options.hcsBaseUrl;
		this.caBundle = options.caBundle;
	}

	async start(): Promise<void> {
		if (this.server) throw new Error("受管回环代理已启动");
		const server = createServer((request, response) => {
			void this.handle(request, response);
		});
		server.on("clientError", (_error, socket) => socket.destroy());
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				server.off("error", reject);
				resolve();
			});
		});
		const address = server.address();
		if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
			server.close();
			throw new Error("受管回环代理未绑定到 127.0.0.1");
		}
		this.server = server;
		this.port = address.port;
	}

	configuration(): ConfigureManagedProviderCommand {
		if (!this.server || this.port === 0) throw new Error("受管回环代理尚未就绪");
		return {
			type: "configure_managed_provider",
			protocolVersion: 1,
			runtimeId: this.runtimeId,
			catalogVersion: this.catalogVersion,
			baseUrl: `http://127.0.0.1:${this.port}/proxy/v1`,
			capability: this.capability,
			models: this.models,
		};
	}

	beginTurn(turnId: string): void {
		if (this.activeTurnId) throw new Error("受管运行时已有活动轮次");
		this.activeTurnId = turnId;
		this.callIds.set(turnId, new Set());
	}

	finishTurn(turnId: string): string[] {
		if (this.activeTurnId === turnId) this.activeTurnId = null;
		const result = [...(this.callIds.get(turnId) ?? [])];
		this.callIds.delete(turnId);
		return result;
	}

	async close(): Promise<void> {
		if (this.closing) return this.closing;
		const server = this.server;
		this.server = null;
		this.port = 0;
		this.activeTurnId = null;
		this.callIds.clear();
		if (!server) return;
		this.closing = new Promise<void>((resolve) => server.close(() => resolve()));
		server.closeAllConnections();
		return this.closing;
	}

	private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		if (
			request.socket.remoteAddress !== "127.0.0.1" ||
			request.method !== "POST" ||
			request.url !== CHAT_PATH
		) {
			jsonError(response, 404, "not_found", "受管回环代理拒绝该请求");
			return;
		}
		const capabilityHeader = request.headers["x-managed-capability"];
		if (!authorized(typeof capabilityHeader === "string" ? capabilityHeader : undefined, this.capability)) {
			jsonError(response, 401, "unauthorized", "受管运行时能力无效");
			return;
		}
		if (!this.activeTurnId) {
			jsonError(response, 409, "no_active_turn", "受管运行时没有活动轮次");
			return;
		}
		let body: Buffer;
		try {
			body = await collectBody(request);
		} catch (error: unknown) {
			jsonError(
				response,
				error instanceof Error && error.message === "payload_too_large" ? 413 : 400,
				"invalid_request",
				"受管模型请求无效",
			);
			return;
		}
		await this.forward(body, response, false);
	}

	private async forward(body: Buffer, response: ServerResponse, retried: boolean): Promise<void> {
		let token: string;
		try {
			token = await this.auth.getValidAccessToken(retried);
		} catch {
			jsonError(response, 401, "unauthorized", "受管登录已失效");
			return;
		}
		const target = new URL(CHAT_PATH, this.hcsBaseUrl);
		await new Promise<void>((resolve) => {
			let upstreamEnded = false;
			const upstream = httpsRequest(
				target,
				{
					method: "POST",
					ca: this.caBundle,
					rejectUnauthorized: true,
					servername: target.hostname,
					headers: {
						authorization: `Bearer ${token}`,
						accept: "application/json, text/event-stream",
						"content-type": "application/json",
						"content-length": body.byteLength,
					},
				},
				(incoming) => {
					if (incoming.statusCode === 401 && !retried) {
						incoming.resume();
						incoming.once("end", () => {
							upstreamEnded = true;
							void this.forward(body, response, true).finally(resolve);
						});
						return;
					}
					const modelCallId = incoming.headers["x-hcs-model-call-id"];
					if (typeof modelCallId === "string" && this.activeTurnId) {
						this.callIds.get(this.activeTurnId)?.add(modelCallId);
					}
					const headers: Record<string, string> = { "cache-control": "no-store" };
					if (typeof incoming.headers["content-type"] === "string") {
						headers["content-type"] = incoming.headers["content-type"];
					}
					if (typeof modelCallId === "string") headers["x-hcs-model-call-id"] = modelCallId;
					response.writeHead(incoming.statusCode ?? 502, headers);
					incoming.on("data", (chunk: Buffer) => {
						if (!response.write(chunk)) incoming.pause();
					});
					response.on("drain", () => incoming.resume());
					incoming.once("end", () => {
						upstreamEnded = true;
						response.end();
						resolve();
					});
					incoming.once("error", () => {
						if (!response.headersSent) jsonError(response, 502, "upstream_error", "受管模型服务中断");
						else response.destroy();
						resolve();
					});
				},
			);
			response.once("close", () => {
				if (!upstreamEnded) upstream.destroy();
			});
			upstream.once("error", () => {
				jsonError(response, 502, "upstream_error", "受管模型服务不可用");
				resolve();
			});
			upstream.setTimeout(120_000, () => upstream.destroy(new Error("managed upstream timeout")));
			upstream.end(body);
		});
	}
}
