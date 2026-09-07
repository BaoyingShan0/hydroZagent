import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { contractSchemaRef } from "../src/contracts/registry.js";

describe("HTTP usage contract preserves wire types", () => {
	it.each([null, "", "fake answer", undefined])("accepts assistant_final %j without coercion", async (assistantFinal) => {
		const app = buildApp({ environment: "test", host: "127.0.0.1", port: 0 });
		app.post("/test-contract", { schema: { body: contractSchemaRef("UsageIngestRequest") } }, async (request) => request.body);
		const payload = { event_id: randomUUID(), session_id: randomUUID(), turn_id: randomUUID(),
			client_created_at: new Date().toISOString(), task_category: "Knowledge", model: "fake-model",
			client_version: "test", device_id: "test-device", turn_status: "aborted", user_input: "fake input",
			anonymous: true, model_call_ids: [], ...(assistantFinal === undefined ? {} : { assistant_final: assistantFinal }) };
		try {
			const response = await app.inject({ method: "POST", url: "/test-contract", payload });
			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual(payload);
			for (const patch of [{ anonymous: "true" }, { assistant_final: 42 }]) {
				const invalid = await app.inject({ method: "POST", url: "/test-contract", payload: { ...payload, ...patch } });
				expect(invalid.statusCode).toBe(400);
			}
		} finally { await app.close(); }
	});
});
