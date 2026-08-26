/**
 * 内置浏览器安全策略共享模块：webview 宿主（旧管线）与 WebContentsView
 * 管理器（UI 2.0 / issue #115 U4）必须使用完全一致的 URL 白名单与 partition，
 * 任何一处修改都要同时生效，故收敛到单一事实源。
 */

export const BROWSER_PANEL_PARTITION = "persist:pideck-browser-panel";

/** 仅允许 http/https 页面与 about:blank 进入内置浏览器；file:// 等本地协议一律拒绝。 */
export function isAllowedBrowserPanelUrl(targetUrl: string): boolean {
	if (targetUrl === "about:blank") return true;
	try {
		const protocol = new URL(targetUrl).protocol;
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}
