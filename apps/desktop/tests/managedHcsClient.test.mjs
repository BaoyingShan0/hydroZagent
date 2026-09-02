import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

test("managed HCS client uses only the compiled HTTPS origin, CA, and hostname", async () => {
  const calls = [];
  const request = (target, options, callback) => {
    const outgoing = new EventEmitter();
    outgoing.setTimeout = () => outgoing;
    outgoing.write = () => true;
    outgoing.destroy = (error) => { if (error) outgoing.emit("error", error); };
    outgoing.end = () => {
      calls.push({ target: String(target), options });
      const incoming = new PassThrough();
      incoming.statusCode = 200;
      incoming.headers = { date: "Tue, 01 Sep 2026 00:00:00 GMT" };
      callback(incoming);
      incoming.end(JSON.stringify({ notice_version: "v1", text: "notice" }));
    };
    return outgoing;
  };
  const { ManagedHcsClient } = loadTsCommonJs("src/main/managed/hcsClient.ts", {
    stubs: { "node:https": { request } },
    globals: {
      __HYDRO_MANAGED__: true,
      __HYDRO_HCS_BASE_URL__: "https://hcs.fixed.internal",
      __HYDRO_HCS_CA_BUNDLE__: "-----BEGIN CERTIFICATE-----\nfixed-ca\n-----END CERTIFICATE-----",
    },
  });
  const previousOrigin = process.env.HYDRO_HCS_BASE_URL;
  process.env.HYDRO_HCS_BASE_URL = "https://attacker.invalid";
  try {
    const client = new ManagedHcsClient();
    await client.json("GET", "/auth/notice");
    assert.equal(calls[0].target, "https://hcs.fixed.internal/auth/notice");
    assert.equal(calls[0].options.servername, "hcs.fixed.internal");
    assert.equal(calls[0].options.rejectUnauthorized, true);
    assert.match(calls[0].options.ca, /fixed-ca/);
    await assert.rejects(client.json("GET", "//attacker.invalid/steal"), /\u8def\u5f84|path/iu);
  } finally {
    if (previousOrigin === undefined) delete process.env.HYDRO_HCS_BASE_URL;
    else process.env.HYDRO_HCS_BASE_URL = previousOrigin;
  }
});
