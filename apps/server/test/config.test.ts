import { describe, expect, it } from "vitest";
import { readRuntimeConfig } from "../src/config/runtimeConfig.js";

describe("readRuntimeConfig", () => {
	it("provides local-only development defaults", () => {
		expect(readRuntimeConfig({})).toEqual({
			environment: "development",
			host: "127.0.0.1",
			port: 8787,
		});
	});

	it("accepts an explicit test database", () => {
		expect(
			readRuntimeConfig({
				HCS_DATABASE_URL: "postgresql://localhost/hcs",
				HCS_ENV: "test",
				HCS_HOST: "0.0.0.0",
				HCS_PORT: "9443",
			}),
		).toEqual({
			databaseUrl: "postgresql://localhost/hcs",
			environment: "test",
			host: "0.0.0.0",
			port: 9443,
		});
	});

	it.each(["0", "65536", "not-a-port"])("rejects invalid port %s", (port) => {
		expect(() => readRuntimeConfig({ HCS_PORT: port })).toThrow(/Invalid HCS runtime configuration/u);
	});

	it("rejects unknown environments", () => {
		expect(() => readRuntimeConfig({ HCS_ENV: "staging" })).toThrow(/HCS_ENV must be/u);
	});

	it("fails closed when production TLS files are not explicitly available", () => {
		expect(() => readRuntimeConfig({ HCS_ENV: "production" })).toThrow("requires TLS certificate and key paths");
		expect(() =>
			readRuntimeConfig({
				HCS_ENV: "production",
				HCS_TLS_CERT_PATH: "missing-server.crt",
				HCS_TLS_KEY_PATH: "missing-server.key",
			}),
		).toThrow("TLS material is unavailable");
	});
});
