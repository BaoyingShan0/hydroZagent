import { safeStorage } from "electron";
import type { SystemBoundEncryption } from "./credentialStore";

export const windowsSystemEncryption: SystemBoundEncryption = {
	isAvailable: () => process.platform === "win32" && safeStorage.isEncryptionAvailable(),
	encrypt: (value) => safeStorage.encryptString(value),
	decrypt: (value) => safeStorage.decryptString(value),
};
