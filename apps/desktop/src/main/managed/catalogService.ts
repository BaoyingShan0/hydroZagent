import type {
	ManagedModel,
	ManagedModelsResponse,
	ThinkingLevel,
} from "../../shared/hcsContracts.generated";
import type { AvailableModel } from "../../shared/types";
import type { ManagedAuthManager } from "./authManager";
import type { ManagedHcsClient } from "./hcsClient";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function managedModel(value: unknown): value is ManagedModel {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.name === "string" &&
		value.provider === "hydro-managed" &&
		Number.isSafeInteger(value.contextWindow) &&
		Number(value.contextWindow) > 0 &&
		Number.isSafeInteger(value.maxTokens) &&
		Number(value.maxTokens) > 0 &&
		typeof value.reasoning === "boolean" &&
		Array.isArray(value.input) &&
		value.input.length > 0 &&
		value.input.every((kind) => kind === "text" || kind === "image")
	);
}

function catalog(value: unknown): ManagedModelsResponse {
	if (
		!isRecord(value) ||
		typeof value.catalog_version !== "string" ||
		typeof value.expires_at !== "string" ||
		!Array.isArray(value.models) ||
		value.models.length === 0 ||
		!value.models.every(managedModel)
	) {
		throw new Error("受管模型目录响应无效");
	}
	return { catalog_version: value.catalog_version, expires_at: value.expires_at, models: value.models };
}

export class ManagedCatalogService {
	private readonly client: ManagedHcsClient;
	private readonly auth: ManagedAuthManager;
	private current: ManagedModelsResponse | null = null;
	private monotonicDeadline = 0;

	constructor(client: ManagedHcsClient, auth: ManagedAuthManager) {
		this.client = client;
		this.auth = auth;
	}

	async getCurrent(forceRefresh = false): Promise<ManagedModelsResponse> {
		if (!forceRefresh && this.current && performance.now() < this.monotonicDeadline) return this.current;
		try {
			const response = await this.client.json("GET", "/proxy/v1/models", {
				accessToken: await this.auth.getValidAccessToken(),
			});
			const next = catalog(response.body);
			const serverNow = response.dateHeader ? Date.parse(response.dateHeader) : Number.NaN;
			const expiresAt = Date.parse(next.expires_at);
			if (!Number.isFinite(serverNow) || !Number.isFinite(expiresAt) || expiresAt <= serverNow) {
				throw new Error("受管模型目录已过期或缺少可信服务端时间");
			}
			this.current = next;
			this.monotonicDeadline = performance.now() + (expiresAt - serverNow);
			return next;
		} catch (error: unknown) {
			if (this.current && performance.now() < this.monotonicDeadline) return this.current;
			this.current = null;
			this.monotonicDeadline = 0;
			throw error;
		}
	}

	isCurrent(): boolean {
		return this.current !== null && performance.now() < this.monotonicDeadline;
	}

	availableModels(): AvailableModel[] {
		if (!this.current || !this.isCurrent()) return [];
		return this.current.models.map((model) => ({
			id: model.id,
			name: model.name,
			provider: "hydro-managed",
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			reasoning: model.reasoning,
			images: model.input.includes("image"),
			...(model.defaultThinkingLevel ? { defaultEffort: model.defaultThinkingLevel } : {}),
			reasoningEfforts: model.reasoning
				? THINKING_LEVELS
					.filter((level) => !model.thinkingLevelMap || model.thinkingLevelMap[level] !== null)
					.map((level) => ({ id: level }))
				: [],
		}));
	}
}
