import { HcsRequestError } from "../auth/errors.js";
import type { ManagedModel, OpenAICompletionsCompat, ThinkingLevel, ThinkingLevelMap } from "../contracts/generated.js";

type CatalogEntry = {
	managedModel: ManagedModel;
	upstreamModel: string;
};

export type ResolvedManagedModel = CatalogEntry;

const MODEL_KEYS = new Set([
	"id",
	"name",
	"provider",
	"contextWindow",
	"maxTokens",
	"reasoning",
	"input",
	"thinkingLevelMap",
	"defaultThinkingLevel",
	"compat",
]);
const THINKING_LEVELS: ReadonlySet<string> = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const COMPAT_BOOLEAN_KEYS = new Set([
	"supportsStore",
	"supportsDeveloperRole",
	"supportsReasoningEffort",
	"supportsUsageInStreaming",
	"supportsFinishReason",
	"requiresToolResultName",
	"requiresAssistantAfterToolResult",
	"requiresThinkingAsText",
	"requiresReasoningContentOnAssistantMessages",
	"zaiToolStream",
	"supportsThinkingTokenBudget",
	"supportsOpenAIGrammarTools",
	"supportsStrictMode",
	"sendSessionAffinityHeaders",
	"supportsLongCacheRetention",
]);
const THINKING_FORMATS = new Set([
	"openai",
	"openrouter",
	"deepseek",
	"together",
	"baseten",
	"zai",
	"qwen",
	"chat-template",
	"qwen-chat-template",
	"string-thinking",
	"ant-ling",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return typeof value === "string" && THINKING_LEVELS.has(value);
}

function isThinkingLevelMap(value: unknown): value is ThinkingLevelMap {
	if (!isRecord(value) || Object.keys(value).some((key) => !THINKING_LEVELS.has(key))) return false;
	return Object.values(value).every((mapped) => mapped === null || typeof mapped === "string");
}

function isCompat(value: unknown): value is OpenAICompletionsCompat {
	if (!isRecord(value)) return false;
	for (const [key, setting] of Object.entries(value)) {
		if (COMPAT_BOOLEAN_KEYS.has(key)) {
			if (typeof setting !== "boolean") return false;
			continue;
		}
		if (key === "maxTokensField") {
			if (setting !== "max_completion_tokens" && setting !== "max_tokens") return false;
			continue;
		}
		if (key === "thinkingFormat") {
			if (typeof setting !== "string" || !THINKING_FORMATS.has(setting)) return false;
			continue;
		}
		if (key === "cacheControlFormat") {
			if (setting !== "anthropic") return false;
			continue;
		}
		if (key === "deferredToolsMode") {
			if (setting !== "kimi") return false;
			continue;
		}
		if (key === "sessionAffinityFormat") {
			if (setting !== "openai" && setting !== "openai-nosession" && setting !== "openrouter") return false;
			continue;
		}
		return false;
	}
	return true;
}

function isManagedModel(value: unknown): value is ManagedModel {
	if (!isRecord(value) || Object.keys(value).some((key) => !MODEL_KEYS.has(key))) return false;
	if (
		typeof value.id !== "string" ||
		value.id.length < 1 ||
		value.id.length > 128 ||
		typeof value.name !== "string" ||
		value.name.length < 1 ||
		value.name.length > 128 ||
		value.provider !== "hydro-managed" ||
		!Number.isSafeInteger(value.contextWindow) ||
		Number(value.contextWindow) < 1 ||
		!Number.isSafeInteger(value.maxTokens) ||
		Number(value.maxTokens) < 1 ||
		typeof value.reasoning !== "boolean" ||
		!Array.isArray(value.input) ||
		value.input.length < 1 ||
		value.input.some((input) => input !== "text" && input !== "image") ||
		new Set(value.input).size !== value.input.length
	) {
		return false;
	}
	if (value.thinkingLevelMap !== undefined && !isThinkingLevelMap(value.thinkingLevelMap)) return false;
	if (value.defaultThinkingLevel !== undefined && !isThinkingLevel(value.defaultThinkingLevel)) return false;
	if (value.compat !== undefined && !isCompat(value.compat)) return false;
	if (!value.reasoning && (value.defaultThinkingLevel !== undefined || value.thinkingLevelMap !== undefined)) return false;
	if (value.defaultThinkingLevel !== undefined && value.thinkingLevelMap?.[value.defaultThinkingLevel] === null) return false;
	return true;
}

export class ModelCatalog {
	readonly version: string;
	readonly expiresAt: Date;
	private readonly entries: Map<string, CatalogEntry>;

	constructor(version: string, expiresAt: Date, entries: CatalogEntry[]) {
		if (!version || version.length > 128 || !Number.isFinite(expiresAt.getTime()) || entries.length === 0) {
			throw new Error("Invalid managed model catalog");
		}
		this.version = version;
		this.expiresAt = expiresAt;
		this.entries = new Map(entries.map((entry) => [entry.managedModel.id, entry]));
		if (this.entries.size !== entries.length) throw new Error("Managed model IDs must be unique");
	}

	models(now: Date): ManagedModel[] {
		this.assertCurrent(now);
		return [...this.entries.values()].map((entry) => entry.managedModel);
	}

	resolve(modelId: string, now: Date): ResolvedManagedModel {
		this.assertCurrent(now);
		const entry = this.entries.get(modelId);
		if (!entry) throw new HcsRequestError("model_not_allowed", 403, "模型不在当前白名单中");
		return entry;
	}

	private assertCurrent(now: Date): void {
		if (this.expiresAt.getTime() <= now.getTime()) {
			throw new HcsRequestError("catalog_unavailable", 503, "模型目录已过期");
		}
	}
}

export function parseModelCatalog(source: string): ModelCatalog {
	const parsed: unknown = JSON.parse(source);
	if (!isRecord(parsed) || typeof parsed.catalog_version !== "string" || typeof parsed.expires_at !== "string") {
		throw new Error("Managed catalog envelope is invalid");
	}
	if (!Array.isArray(parsed.models)) throw new Error("Managed catalog models must be an array");
	const entries: CatalogEntry[] = [];
	for (const value of parsed.models) {
		if (!isRecord(value) || !isManagedModel(value.managed_model) || typeof value.upstream_model !== "string" || !value.upstream_model) {
			throw new Error("Managed catalog entry is invalid");
		}
		entries.push({ managedModel: value.managed_model, upstreamModel: value.upstream_model });
	}
	return new ModelCatalog(parsed.catalog_version, new Date(parsed.expires_at), entries);
}
