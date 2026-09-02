import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

function harness(statuses = [200]) {
  const calls = [];
  let index = 0;
  const request = (target, options, callback) => {
    const emitter = new EventEmitter();
    emitter.setTimeout = () => emitter;
    emitter.destroy = () => emitter;
    emitter.end = (body) => {
      calls.push({ target: String(target), options, body: Buffer.from(body).toString("utf8") });
      const incoming = new PassThrough();
      incoming.statusCode = statuses[index] ?? 200;
      incoming.headers = index === statuses.length - 1
        ? { "content-type": "application/json", "x-hcs-model-call-id": "00000000-0000-4000-8000-000000000099" }
        : { "content-type": "application/json" };
      index += 1;
      callback(incoming);
      incoming.end(JSON.stringify({ ok: true }));
    };
    return emitter;
  };
  const module = loadTsCommonJs("src/main/managed/loopbackProxy.ts", {
    stubs: { "node:https": { request } },
  });
  return { ...module, calls };
}

function options(auth) {
  return {
    sessionId: "00000000-0000-4000-8000-000000000001",
    auth,
    catalogVersion: "catalog-1",
    models: [{
      id: "managed-coder",
      name: "Managed Coder",
      provider: "hydro-managed",
      contextWindow: 128000,
      maxTokens: 8192,
      reasoning: false,
      input: ["text"],
    }],
    hcsBaseUrl: "https://hcs.internal.example",
    caBundle: "test-ca",
  };
}

test("managed loopback allows only the exact chat POST and current capability", async () => {
  const { ManagedLoopbackLease, calls } = harness();
  const auth = { getValidAccessToken: async () => "server-access-token" };
  const lease = new ManagedLoopbackLease(options(auth));
  await lease.start();
  const configuration = lease.configuration();
  try {
    assert.equal((await fetch(`${configuration.baseUrl}/models`)).status, 404);
    assert.equal((await fetch(`${configuration.baseUrl}/chat/completions`)).status, 404);
    assert.equal((await fetch(`${configuration.baseUrl}/chat/completions`, { method: "POST", body: "{}" })).status, 401);
    assert.equal((await fetch(`${configuration.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${configuration.capability}` },
      body: "{}",
    })).status, 401);
	assert.equal((await fetch(`${configuration.baseUrl}/chat/completions`, {
		method: "POST",
		headers: { "x-managed-capability": configuration.capability },
		body: "{}",
	})).status, 409);

    lease.beginTurn("turn-1");
    const response = await fetch(`${configuration.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer must-be-stripped",
        "x-managed-capability": configuration.capability,
        "x-foreign-secret": "must-not-forward",
      },
      body: JSON.stringify({ model: "managed-coder", messages: [{ role: "user", content: "hello" }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].target, "https://hcs.internal.example/proxy/v1/chat/completions");
    assert.equal(calls[0].options.headers.authorization, "Bearer server-access-token");
    assert.equal("x-managed-capability" in calls[0].options.headers, false);
    assert.equal("x-foreign-secret" in calls[0].options.headers, false);
    assert.deepEqual(Array.from(lease.finishTurn("turn-1")), ["00000000-0000-4000-8000-000000000099"]);
  } finally {
    await lease.close();
  }
  await assert.rejects(fetch(`${configuration.baseUrl}/chat/completions`));
});

test("managed loopback retries one pre-body HCS 401 with a forced refresh", async () => {
  const { ManagedLoopbackLease, calls } = harness([401, 200]);
  const refreshFlags = [];
  const auth = {
    getValidAccessToken: async (force) => {
      refreshFlags.push(force === true);
      return force ? "refreshed-token" : "stale-token";
    },
  };
  const lease = new ManagedLoopbackLease(options(auth));
  await lease.start();
  const configuration = lease.configuration();
  try {
	lease.beginTurn("turn-1");
    const response = await fetch(`${configuration.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "x-managed-capability": configuration.capability },
      body: JSON.stringify({ model: "managed-coder", messages: [{ role: "user", content: "hello" }] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(refreshFlags, [false, true]);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.headers.authorization, "Bearer refreshed-token");
  } finally {
    await lease.close();
  }
});
