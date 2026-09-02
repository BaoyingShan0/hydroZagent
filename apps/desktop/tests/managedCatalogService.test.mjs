import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

function model() {
  return {
    id: "managed-coder",
    name: "Managed Coder",
    provider: "hydro-managed",
    contextWindow: 128000,
    maxTokens: 8192,
    reasoning: true,
    input: ["text", "image"],
    defaultThinkingLevel: "medium",
    thinkingLevelMap: { off: null, low: "low", medium: "medium", high: "high" },
  };
}

function response() {
  return {
    statusCode: 200,
    dateHeader: "2026-09-01T00:00:00.000Z",
    modelCallId: null,
    body: {
      catalog_version: "catalog-1",
      expires_at: "2026-09-01T00:01:00.000Z",
      models: [model()],
    },
  };
}

test("managed catalog uses server time, derives desktop models, and fails closed after expiry", async () => {
  let now = 100;
  let mode = "ok";
  const { ManagedCatalogService } = loadTsCommonJs("src/main/managed/catalogService.ts", {
    globals: { performance: { now: () => now } },
  });
  const client = {
    json: async () => {
      if (mode === "error") throw new Error("catalog offline");
      return response();
    },
  };
  const auth = { getValidAccessToken: async () => "access-token" };
  const service = new ManagedCatalogService(client, auth);

  await service.getCurrent();
  const available = JSON.parse(JSON.stringify(service.availableModels()));
  assert.equal(available[0].provider, "hydro-managed");
  assert.equal(available[0].images, true);
  assert.deepEqual(available[0].reasoningEfforts, [
    { id: "minimal" },
    { id: "low" },
    { id: "medium" },
    { id: "high" },
    { id: "xhigh" },
    { id: "max" },
  ]);

  mode = "error";
  assert.equal((await service.getCurrent(true)).catalog_version, "catalog-1");
  now = 60_101;
  await assert.rejects(service.getCurrent(), /catalog offline/);
  assert.equal(service.isCurrent(), false);
  assert.deepEqual(Array.from(service.availableModels()), []);
});

test("managed catalog rejects missing trusted Date and already-expired responses", async () => {
  const { ManagedCatalogService } = loadTsCommonJs("src/main/managed/catalogService.ts");
  const auth = { getValidAccessToken: async () => "access-token" };
  for (const patch of [
    { dateHeader: null },
    { body: { ...response().body, expires_at: "2026-08-31T23:59:59.000Z" } },
  ]) {
    const client = { json: async () => ({ ...response(), ...patch }) };
    const service = new ManagedCatalogService(client, auth);
    await assert.rejects(service.getCurrent(), /expired|time|\u8fc7\u671f|\u65f6\u95f4/iu);
    assert.equal(service.isCurrent(), false);
  }
});
