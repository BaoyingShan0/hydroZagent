import { request } from "node:https";
import { MANAGED_BUILD } from "./buildManifest";

export type HcsResponse = {
	statusCode: number;
	body: unknown;
	dateHeader: string | null;
	modelCallId: string | null;
};

export class HcsClientError extends Error {
	readonly statusCode: number;
	readonly code: string;

	constructor(statusCode: number, code: string, message: string) {
		super(message);
		this.name = "HcsClientError";
		this.statusCode = statusCode;
		this.code = code;
	}
}

function errorBody(value: unknown): { code: string; message: string } | null {
	if (
		typeof value !== "object" ||
		value === null ||
		!("error" in value) ||
		typeof value.error !== "object" ||
		value.error === null ||
		!("code" in value.error) ||
		typeof value.error.code !== "string" ||
		!("message" in value.error) ||
		typeof value.error.message !== "string"
	) {
		return null;
	}
	return { code: value.error.code, message: value.error.message };
}

export class ManagedHcsClient {
	private readonly baseUrl: URL;
	private readonly caBundle: string;

	constructor() {
		if (!MANAGED_BUILD.managed) throw new Error("当前不是受管构建");
		this.baseUrl = new URL(MANAGED_BUILD.hcsBaseUrl);
		this.caBundle = MANAGED_BUILD.caBundle;
	}

	async json(
		method: "GET" | "POST",
		path: string,
		options: { accessToken?: string; body?: object; timeoutMilliseconds?: number } = {},
	): Promise<HcsResponse> {
		if (!path.startsWith("/") || path.startsWith("//")) throw new Error("受管 HCS 路径无效");
		const target = new URL(path, this.baseUrl);
		if (target.origin !== this.baseUrl.origin) throw new Error("受管 HCS 请求越界");
		const serialized = options.body === undefined ? undefined : JSON.stringify(options.body);
		const response = await new Promise<HcsResponse>((resolve, reject) => {
			const req = request(
				target,
				{
					method,
					ca: this.caBundle,
					rejectUnauthorized: true,
					servername: this.baseUrl.hostname,
					headers: {
						accept: "application/json",
						...(serialized === undefined
							? {}
							: { "content-type": "application/json", "content-length": Buffer.byteLength(serialized) }),
						...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
					},
				},
				(incoming) => {
					const chunks: Buffer[] = [];
					let length = 0;
					incoming.on("data", (chunk: Buffer) => {
						length += chunk.byteLength;
						if (length > 2 * 1024 * 1024) {
							incoming.destroy(new Error("HCS response exceeded the managed limit"));
							return;
						}
						chunks.push(chunk);
					});
					incoming.on("error", reject);
					incoming.on("end", () => {
						let body: unknown = null;
						try {
							const text = Buffer.concat(chunks).toString("utf8");
							body = text.length === 0 ? null : JSON.parse(text);
						} catch {
							reject(new Error("HCS returned invalid JSON"));
							return;
						}
						resolve({
							statusCode: incoming.statusCode ?? 502,
							body,
							dateHeader: typeof incoming.headers.date === "string" ? incoming.headers.date : null,
							modelCallId:
								typeof incoming.headers["x-hcs-model-call-id"] === "string"
									? incoming.headers["x-hcs-model-call-id"]
									: null,
						});
					});
				},
			);
			req.once("error", reject);
			req.setTimeout(options.timeoutMilliseconds ?? 15_000, () => req.destroy(new Error("HCS request timed out")));
			if (serialized !== undefined) req.write(serialized);
			req.end();
		});
		if (response.statusCode < 200 || response.statusCode >= 300) {
			const safe = errorBody(response.body);
			throw new HcsClientError(response.statusCode, safe?.code ?? "hcs_unavailable", safe?.message ?? "受管服务暂时不可用");
		}
		return response;
	}
}
