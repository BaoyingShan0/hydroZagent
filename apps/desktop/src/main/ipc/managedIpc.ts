import type { IpcMain } from "electron";
import { ipcChannels } from "../../shared/ipc";
import type { ManagedAccessStatus, ManagedConsentInput, ManagedLoginInput } from "../../shared/types/managed";
import type { ManagedAuthManager } from "../managed/authManager";
import { MANAGED_BUILD } from "../managed/buildManifest";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	return Object.keys(value).length === expected.length && expected.every((key) => key in value);
}

function loginInput(value: unknown): ManagedLoginInput {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["username", "password"]) ||
		typeof value.username !== "string" ||
		value.username.length < 1 ||
		value.username.length > 64 ||
		typeof value.password !== "string" ||
		value.password.length < 1 ||
		value.password.length > 128
	) {
		throw new Error("受管登录参数无效");
	}
	return { username: value.username, password: value.password };
}

function consentInput(value: unknown): ManagedConsentInput {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["noticeVersion"]) ||
		typeof value.noticeVersion !== "string" ||
		value.noticeVersion.length < 1 ||
		value.noticeVersion.length > 64
	) {
		throw new Error("受管同意参数无效");
	}
	return { noticeVersion: value.noticeVersion };
}

function unavailableStatus(): ManagedAccessStatus {
	return { managed: MANAGED_BUILD.managed, authenticated: false, user: null, failure: null, consent: "unknown" };
}

function required(manager: ManagedAuthManager | undefined): ManagedAuthManager {
	if (!manager) throw new Error("受管身份服务不可用");
	return manager;
}

/** Registers the minimal renderer-facing managed account boundary with strict runtime validation. */
export function registerManagedIpc(ipcMain: IpcMain, manager: ManagedAuthManager | undefined): void {
	ipcMain.handle(ipcChannels.managedStatus, () => manager?.status() ?? unavailableStatus());
	ipcMain.handle(ipcChannels.managedLogin, (_event, input: unknown) => {
		const validated = loginInput(input);
		return required(manager).login(validated, false);
	});
	ipcMain.handle(ipcChannels.managedRegister, (_event, input: unknown) => {
		const validated = loginInput(input);
		return required(manager).login(validated, true);
	});
	ipcMain.handle(ipcChannels.managedNotice, () => required(manager).currentNotice());
	ipcMain.handle(ipcChannels.managedConsent, (_event, input: unknown) => {
		const validated = consentInput(input);
		return required(manager).consent(validated);
	});
	ipcMain.handle(ipcChannels.managedWithdraw, () => required(manager).withdraw());
	ipcMain.handle(ipcChannels.managedLogout, () => required(manager).logout());
	ipcMain.handle(ipcChannels.managedDeactivate, () => required(manager).deactivate());
}
