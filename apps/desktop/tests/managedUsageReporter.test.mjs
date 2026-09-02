import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

class HcsClientError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const { ManagedUsageReporter } = loadTsCommonJs("src/main/managed/usageReporter.ts", {
  stubs: { "./hcsClient": { HcsClientError } },
});

function usage() {
  return {
    eventId: "00000000-0000-4000-8000-000000000001",
    sessionId: "00000000-0000-4000-8000-000000000002",
    turnId: "00000000-0000-4000-8000-000000000003",
    clientCreatedAt: "2026-09-01T00:00:00.000Z",
    model: "managed-coder",
    status: "completed",
    userInput: "user input captured after consent",
    assistantFinal: "assistant final only",
    anonymous: true,
    modelCallIds: ["00000000-0000-4000-8000-000000000004"],
  };
}

test("managed usage retries only in memory and sends the bounded P0 record", async () => {
  const calls = [];
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const client = {
    json: async (method, path, options) => {
      calls.push({ method, path, options });
      if (calls.length < 3) throw new Error("temporary outage");
      finish();
      return { statusCode: 202, body: {}, dateHeader: null, modelCallId: null };
    },
  };
  const reporter = new ManagedUsageReporter({
    client,
    auth: { getValidAccessToken: async () => "access-token" },
    clientVersion: "1.2.3",
    deviceId: "device-1",
    retryDelays: [0, 0, 0, 0],
    onFailure: () => assert.fail("successful retry must not notify failure"),
  });
  reporter.report(usage());
  await done;

  assert.equal(calls.length, 3);
  assert.equal(calls[2].path, "/ingest/usage");
  assert.equal(calls[2].options.accessToken, "access-token");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[2].options.body)), {
    event_id: usage().eventId,
    session_id: usage().sessionId,
    turn_id: usage().turnId,
    client_created_at: usage().clientCreatedAt,
    task_category: "Knowledge",
    model: "managed-coder",
    client_version: "1.2.3",
    device_id: "device-1",
    turn_status: "completed",
    user_input: usage().userInput,
    assistant_final: usage().assistantFinal,
    anonymous: true,
    model_call_ids: usage().modelCallIds,
  });
});

test("managed usage stops after the retry bound and makes failure visible", async () => {
  let calls = 0;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const reporter = new ManagedUsageReporter({
    client: { json: async () => { calls += 1; throw new Error("offline"); } },
    auth: { getValidAccessToken: async () => "access-token" },
    clientVersion: "1.2.3",
    deviceId: "device-1",
    retryDelays: [0, 0, 0, 0],
    onFailure: finish,
  });
  reporter.report(usage());
  await done;
  assert.equal(calls, 4);
});

test("managed usage does not retry a permanent client error", async () => {
  let calls = 0;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const reporter = new ManagedUsageReporter({
    client: { json: async () => { calls += 1; throw new HcsClientError(400, "invalid_request", "bad"); } },
    auth: { getValidAccessToken: async () => "access-token" },
    clientVersion: "1.2.3",
    deviceId: "device-1",
    retryDelays: [0, 0, 0, 0],
    onFailure: finish,
  });
  reporter.report(usage());
  await done;
  assert.equal(calls, 1);
});
