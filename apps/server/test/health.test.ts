import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const openApps: FastifyInstance[] = [];

afterEach(async () => {
	await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("GET /healthz", () => {
	it("reports liveness without depending on PostgreSQL", async () => {
		const app = buildApp({ environment: "test", host: "127.0.0.1", port: 8787 });
		openApps.push(app);

		const response = await app.inject({ method: "GET", url: "/healthz" });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ status: "ok", service: "hydro-control-server" });
	});

	it("does not expose an accidental root endpoint", async () => {
		const app = buildApp({ environment: "test", host: "127.0.0.1", port: 8787 });
		openApps.push(app);

		const response = await app.inject({ method: "GET", url: "/" });

		expect(response.statusCode).toBe(404);
	});

	it("binds a loopback socket and serves the health contract", async () => {
		const app = buildApp({ environment: "test", host: "127.0.0.1", port: 8787 });
		openApps.push(app);
		const address = await app.listen({ host: "127.0.0.1", port: 0 });

		const response = await fetch(`${address}/healthz`);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "ok", service: "hydro-control-server" });
	});

	it("fails readiness when runtime services are absent and passes only an empty issue set", async () => {
		const unavailable = buildApp({ environment: "test", host: "127.0.0.1", port: 8787 });
		const ready = buildApp(
			{ environment: "test", host: "127.0.0.1", port: 8787 },
			{ readiness: async () => [] },
		);
		openApps.push(unavailable, ready);

		const unavailableResponse = await unavailable.inject({ method: "GET", url: "/readyz" });
		const readyResponse = await ready.inject({ method: "GET", url: "/readyz" });

		expect(unavailableResponse.statusCode).toBe(503);
		expect(unavailableResponse.json()).toEqual({ status: "not_ready", service: "hydro-control-server" });
		expect(readyResponse.statusCode).toBe(200);
		expect(readyResponse.json()).toEqual({ status: "ready", service: "hydro-control-server" });
	});
});
