import { describe, expect, it } from "vitest";
import { type AppliedManagedProvider, ManagedProviderController } from "../src/modes/rpc/managed-provider.ts";
import type { ConfigureManagedProviderCommand } from "../src/modes/rpc/managedProvider.generated.ts";

const CAPABILITY = "runtime-capability-that-must-never-be-serialized";

function command(overrides: Partial<ConfigureManagedProviderCommand> = {}): ConfigureManagedProviderCommand {
	return {
		id: "request-1",
		type: "configure_managed_provider",
		protocolVersion: 1,
		runtimeId: "00000000-0000-4000-8000-000000000001",
		catalogVersion: "catalog-1",
		baseUrl: "http://127.0.0.1:49152/proxy/v1",
		capability: CAPABILITY,
		models: [
			{
				id: "managed-coder",
				name: "Managed Coder",
				provider: "hydro-managed",
				contextWindow: 128_000,
				maxTokens: 8192,
				reasoning: true,
				input: ["text", "image"],
				defaultThinkingLevel: "medium",
				thinkingLevelMap: { off: null, medium: "medium", high: "high" },
				compat: { supportsUsageInStreaming: true, maxTokensField: "max_completion_tokens" },
			},
		],
		...overrides,
	};
}

describe("ManagedProviderController", () => {
	it("maps the canonical model and keeps the capability only in a private transport closure", async () => {
		const applied: AppliedManagedProvider[] = [];
		const controller = new ManagedProviderController({
			enabled: true,
			apply: async (provider) => {
				applied.push(provider);
			},
		});
		const response = await controller.configure(command());

		expect(response).toMatchObject({
			type: "response",
			command: "configure_managed_provider",
			success: true,
			data: { configured: true, protocolVersion: 1, catalogVersion: "catalog-1" },
		});
		expect(applied).toHaveLength(1);
		expect(applied[0]).toMatchObject({
			providerId: "hydro-managed",
			initialModelId: "managed-coder",
			defaultThinkingLevel: "medium",
			configuration: {
				api: "openai-completions",
				baseUrl: "http://127.0.0.1:49152/proxy/v1",
				apiKey: "managed-loopback-transport",
				models: [
					{
						id: "managed-coder",
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					},
				],
			},
		});
		expect(JSON.stringify(applied[0])).not.toContain(CAPABILITY);
		expect(JSON.stringify(applied[0]?.configuration.models)).not.toContain("headers");
		expect(typeof applied[0]?.configuration.streamSimple).toBe("function");
	});

	it("is idempotent for the identical configuration and freezes changes after the first prompt", async () => {
		let applications = 0;
		const controller = new ManagedProviderController({
			enabled: true,
			apply: async () => {
				applications += 1;
			},
		});
		expect((await controller.configure(command())).success).toBe(true);
		controller.markRuntimeStarted();
		expect((await controller.configure(command())).success).toBe(true);
		expect(applications).toBe(1);
		const changed = await controller.configure(command({ catalogVersion: "catalog-2" }));
		expect(changed).toMatchObject({ success: false, errorCode: "managed_runtime_started" });
	});

	it("rejects unsupported protocols, unsafe loopback URLs, duplicates, and non-managed models", async () => {
		const controller = new ManagedProviderController({ enabled: true, apply: async () => undefined });
		const unsupported = command();
		Object.defineProperty(unsupported, "protocolVersion", { value: 2 });
		expect(await controller.configure(unsupported)).toMatchObject({
			success: false,
			errorCode: "managed_protocol_unsupported",
		});
		expect(await controller.configure(command({ baseUrl: "http://localhost:49152/proxy/v1" }))).toMatchObject({
			success: false,
			errorCode: "managed_config_invalid",
		});
		const duplicate = command();
		duplicate.models.push({ ...duplicate.models[0]! });
		expect(await controller.configure(duplicate)).toMatchObject({
			success: false,
			errorCode: "managed_config_invalid",
		});
		const foreign = command();
		Object.defineProperty(foreign.models[0], "provider", { value: "openai" });
		expect(await controller.configure(foreign)).toMatchObject({
			success: false,
			errorCode: "managed_config_invalid",
		});
	});

	it("fails closed when the process was not launched in managed RPC mode", async () => {
		const controller = new ManagedProviderController({ enabled: false, apply: async () => undefined });
		expect(await controller.configure(command())).toMatchObject({
			success: false,
			errorCode: "managed_config_invalid",
		});
	});
});
