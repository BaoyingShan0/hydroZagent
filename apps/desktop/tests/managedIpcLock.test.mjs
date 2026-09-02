import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { ipcChannels } = loadTsCommonJs("src/shared/ipc.ts");
const { enforceManagedIpcLock } = loadTsCommonJs("src/main/managed/ipcLock.ts");

test("managed IPC lock replaces every external model, runtime replacement, log, and updater surface", async () => {
  const handlers = new Map();
  const removedListeners = new Set();
  const ipcMain = {
    removeHandler: (channel) => handlers.delete(channel),
    removeAllListeners: (channel) => removedListeners.add(channel),
    handle: (channel, handler) => handlers.set(channel, handler),
  };
  enforceManagedIpcLock(ipcMain);

  const blockedKeys = [
    "dshListModels",
    "feishuConnect",
    "visionGetConfig",
    "imagegenGenerate",
    "configGetModels",
    "piCheckCustom",
    "piUpdate",
    "piExecInstall",
    "wslListDistros",
    "extensionsInstall",
    "skillsCreate",
    "gitGenerateCommitMessage",
    "rpcLoggingSet",
    "appCheckUpdate",
    "appDownloadUpdate",
    "appInstallUpdate",
  ];
  for (const key of blockedKeys) {
    const channel = ipcChannels[key];
    assert.equal(typeof channel, "string", `missing IPC fixture: ${key}`);
    assert.equal(removedListeners.has(channel), true, `listeners not removed: ${key}`);
    assert.equal(handlers.has(channel), true, `fail-closed handler missing: ${key}`);
    await assert.rejects(Promise.resolve().then(() => handlers.get(channel)()), /\u53d7\u7ba1|managed/iu);
  }
  assert.equal(handlers.has(ipcChannels.settingsGet), false);
  assert.equal(handlers.has(ipcChannels.managedStatus), false);
});
