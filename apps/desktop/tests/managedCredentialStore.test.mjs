import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { ManagedCredentialStore } = loadTsCommonJs("src/main/managed/credentialStore.ts");

const encryption = {
  isAvailable: () => true,
  encrypt: (value) => Buffer.from(value, "utf8").map((byte) => byte ^ 0xa5),
  decrypt: (value) => Buffer.from(value).map((byte) => byte ^ 0xa5).toString("utf8"),
};

test("managed credentials round-trip through one ciphertext-only envelope", async () => {
  const root = await mkdtemp(join(tmpdir(), "hydro-managed-credential-"));
  const path = join(root, "credentials.enc");
  const store = new ManagedCredentialStore(path, encryption);
  const credential = {
    accessToken: "access-secret-not-on-disk",
    refreshToken: "refresh-secret-not-on-disk",
    accessExpiresAt: Date.now() + 60_000,
    user: { id: "user-1", username: "tester", role: "user", is_self_reported: true },
  };
  try {
    await store.save(credential);
    const disk = await readFile(path, "utf8");
    assert.equal(disk.includes(credential.accessToken), false);
    assert.equal(disk.includes(credential.refreshToken), false);
    assert.deepEqual(JSON.parse(JSON.stringify(await store.load())), credential);
    await store.clear();
    assert.equal(await store.load(), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid managed credential ciphertext fails closed and is removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "hydro-managed-credential-tamper-"));
  const path = join(root, "credentials.enc");
  const store = new ManagedCredentialStore(path, encryption);
  try {
    await writeFile(path, JSON.stringify({ v: 1, ciphertext: Buffer.from("tampered").toString("base64") }));
    await assert.rejects(store.load(), /already|clear|\u5df2\u6e05\u9664|\u65e0\u6cd5\u89e3\u5bc6/u);
    assert.equal(await store.load(), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("managed credential storage rejects unavailable system encryption", () => {
  const store = new ManagedCredentialStore("unused", {
    isAvailable: () => false,
    encrypt: () => Buffer.alloc(0),
    decrypt: () => "",
  });
  assert.throws(() => store.assertAvailable(), /\u7cfb\u7edf\u7ed1\u5b9a\u52a0\u5bc6\u4e0d\u53ef\u7528/u);
});
