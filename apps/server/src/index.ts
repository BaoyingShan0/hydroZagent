import { buildApp } from "./app.js";
import { bootstrapAuth } from "./auth/bootstrap.js";
import { readRuntimeConfig } from "./config/runtimeConfig.js";
import { bootstrapConsent } from "./consent/bootstrap.js";
import { bootstrapProxy } from "./proxy/bootstrap.js";
import { bootstrapUsage } from "./usage/bootstrap.js";
import { bootstrapLifecycle } from "./lifecycle/bootstrap.js";

async function main(): Promise<void> {
	const config = readRuntimeConfig();
	const runtime = await bootstrapAuth(process.env);
	const consentRuntime = await bootstrapConsent(runtime.pool, process.env);
	const proxyRuntime = bootstrapProxy(runtime.pool, process.env);
	const usageRuntime = bootstrapUsage(runtime.pool, process.env);
	const lifecycleRuntime = await bootstrapLifecycle(runtime.pool, process.env);
	const readiness = async (): Promise<string[]> => [
		...(await runtime.readiness()),
		...(await consentRuntime.readiness()),
		...(await proxyRuntime.readiness()),
		...(await usageRuntime.readiness()),
		...(await lifecycleRuntime.readiness()),
	];
	const app = buildApp(config, {
		auth: runtime.auth,
		consent: consentRuntime.consent,
		proxy: proxyRuntime.proxy,
		proxyMaximumResponseBytes: proxyRuntime.maximumResponseBytes,
		usage: usageRuntime.usage,
		usageMaximumPayloadBytes: usageRuntime.maximumPayloadBytes,
		readiness,
	});
	let closing = false;

	const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
		if (closing) return;
		closing = true;
		app.log.info({ signal }, "HCS shutdown requested");
		await app.close();
		await lifecycleRuntime.close();
		await runtime.close();
	};

	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => {
			void shutdown(signal).catch((error: unknown) => {
				app.log.error({ err: error }, "HCS shutdown failed");
				process.exitCode = 1;
			});
		});
	}

	try {
		await app.listen({ host: config.host, port: config.port });
	} catch (error: unknown) {
		app.log.error({ err: error }, "HCS startup failed");
		await lifecycleRuntime.close();
		await runtime.close();
		throw error;
	}
}

await main().catch(() => {
	process.stderr.write("HCS failed to start; inspect structured service logs.\n");
	process.exitCode = 1;
});
