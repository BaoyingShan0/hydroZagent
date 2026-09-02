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

test("managed withdrawal uses the canonical HCS route and immediately revokes local Agent access", async () => {
  const calls = [];
  let credential = null;
  let accessLost = 0;
  const client = {
    json: async (method, path, options) => {
      calls.push({ method, path, options });
      if (path === "/auth/login") {
        return {
          body: {
            access_token: "access-token",
            refresh_token: "refresh-token",
            token_type: "Bearer",
            expires_in: 300,
            user: { id: "user-1", username: "alice", role: "user", is_self_reported: true },
          },
        };
      }
      return { body: {} };
    },
  };
  const store = {
    assertAvailable: () => undefined,
    load: async () => credential,
    save: async (value) => { credential = value; },
    clear: async () => { credential = null; },
  };
  const { ManagedAuthManager } = loadTsCommonJs("src/main/managed/authManager.ts", {
    stubs: {
      "./buildManifest": { MANAGED_BUILD: { managed: true } },
      "./hcsClient": { HcsClientError },
    },
  });
  const manager = new ManagedAuthManager(client, store, {
    deviceId: "device-from-main",
    clientVersion: "1.2.3",
    onAccessLost: () => { accessLost += 1; },
  });
  await manager.login({ username: "alice", password: "long-password" }, false);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "/auth/login");
  assert.equal(calls[0].options.body.device_id, "device-from-main");
  assert.equal(calls[0].options.body.client_version, "1.2.3");
  assert.equal(manager.status().consent, "valid");
  await manager.withdraw();
  assert.equal(calls.at(-1).path, "/auth/withdraw-consent");
  assert.equal(manager.status().consent, "required");
  assert.equal(accessLost, 1);
});
