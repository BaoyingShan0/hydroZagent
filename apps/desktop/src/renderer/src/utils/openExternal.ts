import { desktopApi } from "../desktopApi";

/**
 * 在系统默认浏览器中打开 URL，绕过应用的"应用内窗口"设置。
 */
export function openInSystemBrowser(url: string): void {
	void desktopApi.app.openExternal(url, true);
}
