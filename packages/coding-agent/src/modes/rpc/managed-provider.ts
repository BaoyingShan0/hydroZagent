import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ProviderConfigInput } from "../../core/provider-composer.ts";
import type {
	ConfigureManagedProviderCommand,
	ConfigureManagedProviderResponse,
	ManagedModel,
} from "./managedProvider.generated.ts";

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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validManagedModel(value: unknown): value is ManagedModel {
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
		value.input.some((kind) => kind !== "text" && kind !== "image")
	) {
		return false;
	}
	return value.thinkingLevelMap === undefined || isRecord(value.thinkingLevelMap);
}

function validLoopbackBaseUrl(source: unknown): source is string {
	if (typeof source !== "string" || !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/proxy\/v1$/u.test(source)) return false;
	const url = new URL(source);
	const port = Number(url.port);
	return (
		port >= 1 && port <= 65_535 && url.username === "" && url.password === "" && url.search === "" && url.hash === ""
	);
}

function validUuid(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
	);
}

function normalized(command: ConfigureManagedProviderCommand): string {
	return JSON.stringify({
		protocolVersion: command.protocolVersion,
		runtimeId: command.runtimeId,
		catalogVersion: command.catalogVersion,
		baseUrl: command.baseUrl,
		capability: command.capability,
		models: command.models,
	});
}

function providerConfig(command: ConfigureManagedProviderCommand): ProviderConfigInput {
	const transport = openAICompletionsApi();
	const capability = command.capability;
	return {
		name: "Hydro Managed",
		baseUrl: command.baseUrl,
		apiKey: "managed-loopback-transport",
		streamSimple: (model, context, options) =>
			transport.streamSimple(model, context, {
				...options,
				apiKey: "managed-loopback-placeholder",
				headers: { "X-Managed-Capability": capability },
			}),
		api: "openai-completions",
		models: command.models.map((model) => ({
			id: model.id,
			name: model.name,
			api: "openai-completions",
			reasoning: model.reasoning,
			input: [...model.input],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
			...(model.compat ? { compat: model.compat } : {}),
		})),
	};
}

export type AppliedManagedProvider = {
	providerId: "hydro-managed";
	configuration: ProviderConfigInput;
	initialModelId: string;
	defaultThinkingLevel: ManagedModel["defaultThinkingLevel"];
};

export class ManagedProviderController {
	private readonly enabled: boolean;
	private readonly apply: (provider: AppliedManagedProvider) => Promise<void>;
	private configuration: ConfigureManagedProviderCommand | null = null;
	private configurationIdentity: string | null = null;
	private runtimeStarted = false;

	constructor(options: { enabled: boolean; apply: (provider: AppliedManagedProvider) => Promise<void> }) {
		this.enabled = options.enabled;
		this.apply = options.apply;
	}

	isConfigured(): boolean {
		return this.configuration !== null;
	}

	markRuntimeStarted(): void {
		this.runtimeStarted = true;
	}

	async reapply(): Promise<void> {
		if (this.configuration) await this.applyConfiguration(this.configuration);
	}

	async configure(command: ConfigureManagedProviderCommand): Promise<ConfigureManagedProviderResponse> {
		const fail = (
			errorCode: "managed_protocol_unsupported" | "managed_config_invalid" | "managed_runtime_started",
			error: string,
		): ConfigureManagedProviderResponse => ({
			...(command.id === undefined ? {} : { id: command.id }),
			type: "response",
			command: "configure_managed_provider",
			success: false,
			error,
			errorCode,
		});
		if (!this.enabled) return fail("managed_config_invalid", "Managed RPC is not enabled");
		if (Number(command.protocolVersion) !== 1) {
			return fail("managed_protocol_unsupported", "Unsupported managed provider protocol version");
		}
		if (
			!validUuid(command.runtimeId) ||
			typeof command.catalogVersion !== "string" ||
			command.catalogVersion.length < 1 ||
			command.catalogVersion.length > 128 ||
			!validLoopbackBaseUrl(command.baseUrl) ||
			typeof command.capability !== "string" ||
			command.capability.length < 32 ||
			command.capability.length > 512 ||
			!Array.isArray(command.models) ||
			command.models.length < 1 ||
			command.models.some((model) => !validManagedModel(model)) ||
			new Set(command.models.map((model) => model.id)).size !== command.models.length
		) {
			return fail("managed_config_invalid", "Invalid managed provider configuration");
		}
		const identity = normalized(command);
		if (identity === this.configurationIdentity) {
			return this.success(command);
		}
		if (this.runtimeStarted) return fail("managed_runtime_started", "Managed runtime has already started");
		try {
			await this.applyConfiguration(command);
		} catch {
			return fail("managed_config_invalid", "Managed provider configuration could not be applied");
		}
		this.configuration = command;
		this.configurationIdentity = identity;
		return this.success(command);
	}

	private async applyConfiguration(command: ConfigureManagedProviderCommand): Promise<void> {
		const initial = command.models[0];
		if (!initial) throw new Error("Managed provider requires a model");
		await this.apply({
			providerId: "hydro-managed",
			configuration: providerConfig(command),
			initialModelId: initial.id,
			defaultThinkingLevel: initial.defaultThinkingLevel,
		});
	}

	private success(command: ConfigureManagedProviderCommand): ConfigureManagedProviderResponse {
		return {
			...(command.id === undefined ? {} : { id: command.id }),
			type: "response",
			command: "configure_managed_provider",
			success: true,
			data: { configured: true, protocolVersion: 1, catalogVersion: command.catalogVersion },
		};
	}
}
