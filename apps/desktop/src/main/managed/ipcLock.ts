import type { IpcMain } from "electron";
import { ipcChannels } from "../../shared/ipc";

const BLOCKED_KEY = /(?:dsh|feishu|vision|imagegen|webService|config|providerMigration|piCheckCustom|piUpdate|piExecInstall|piCheckNpm|wsl|extensions|skills|projectResources.*(?:Skill|Extension)|settingsTestPiProxy|sessionsRuntimeSetPermission|gitGenerateCommitMessage|rpcLog|app(?:Check|Download|Install)Update)/iu;

export function enforceManagedIpcLock(ipcMain: IpcMain): void {
	for (const [key, channel] of Object.entries(ipcChannels)) {
		if (!BLOCKED_KEY.test(key)) continue;
		ipcMain.removeHandler(channel);
		ipcMain.removeAllListeners(channel);
		ipcMain.handle(channel, () => {
			throw new Error("受管制品已禁用该功能");
		});
	}
}
