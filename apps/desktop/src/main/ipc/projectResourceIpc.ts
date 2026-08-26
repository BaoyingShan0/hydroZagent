import { ipcMain } from "electron";
import { ipcChannels } from "../../shared/ipc";
import type { CreateProjectSkillInput } from "../../shared/types";
import type { AppLogger } from "../logging/AppLogger";
import type { ProjectResourceManager } from "../projects/ProjectResourceManager";

export type ProjectResourceIpcDeps = {
	appLogger: Pick<AppLogger, "info">;
	projectResourceManager: ProjectResourceManager;
};

export function registerProjectResourceIpc({
	appLogger,
	projectResourceManager,
}: ProjectResourceIpcDeps): void {
	ipcMain.handle(ipcChannels.projectResourcesList, async (_event, projectId: string) => {
		return projectResourceManager.list(projectId);
	});
	ipcMain.handle(ipcChannels.projectResourcesCreateSkill, async (_event, input: CreateProjectSkillInput) => {
		const result = await projectResourceManager.createSkill(input);
		void appLogger.info("project-resource", "Project skill created", { projectId: input.projectId, name: result.name });
		return result;
	});
	ipcMain.handle(ipcChannels.projectResourcesDeleteSkill, async (_event, projectId: string, skillPath: string) => {
		// The manager resolves and rechecks project ownership before deleting renderer-supplied paths.
		await projectResourceManager.deleteSkill(projectId, skillPath);
		void appLogger.info("project-resource", "Project skill deleted", { projectId, skillPath });
	});
	ipcMain.handle(ipcChannels.projectResourcesDeleteExtension, async (_event, projectId: string, extensionPath: string) => {
		// Extensions are discovered locally; deletion remains constrained to the project's extension directory.
		await projectResourceManager.deleteExtension(projectId, extensionPath);
		void appLogger.info("project-resource", "Project extension deleted", { projectId, extensionPath });
	});
	ipcMain.handle(ipcChannels.projectResourcesToggleSkill, async (_event, projectId: string, skillPath: string, enabled: boolean) => {
		const result = await projectResourceManager.toggleSkill(projectId, skillPath, enabled);
		void appLogger.info("project-resource", "Project skill toggled", { projectId, skillPath, enabled });
		return result;
	});
	ipcMain.handle(ipcChannels.projectResourcesToggleExtension, async (_event, projectId: string, extensionPath: string, enabled: boolean) => {
		await projectResourceManager.toggleExtension(projectId, extensionPath, enabled);
		void appLogger.info("project-resource", "Project extension toggled", { projectId, extensionPath, enabled });
	});
	ipcMain.handle(ipcChannels.projectResourcesRenameSkill, async (_event, projectId: string, skillPath: string, newName: string) => {
		const result = await projectResourceManager.renameSkill(projectId, skillPath, newName);
		void appLogger.info("project-resource", "Project skill renamed", { projectId, skillPath, newName });
		return result;
	});
}
