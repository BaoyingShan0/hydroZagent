import { resolveAppColorScheme } from "../../shared/themeSchedule";
import type { AppSettings } from "../../shared/types";
import { SKIN_PRESETS } from "./themePresets";

/** 外观相关设置子集：明暗（含跟随时间）、外观主题、主色 */
export type AppearanceSettings = Pick<
  AppSettings,
  "theme" | "themeScheduleLightStart" | "themeScheduleDarkStart" | "themeSkin" | "accent"
>;

/**
 * 把外观设置应用到 <html> 的 data-* 属性（data-theme / data-appearance / data-accent）。
 *
 * App.tsx（持久化 settings，含跟随系统的 media 监听与跟随时间的定时器）与
 * 设置弹窗（草稿实时预览）共用这一份实现，保证「预览」与「保存后」渲染结果一致：
 * - data-theme：浅/暗（system 由调用方传入 systemPrefersDark）；
 * - data-appearance：外观主题 id，驱动 foundation.css 的 [data-appearance] 表面色板块；
 * - data-accent：外观主题自带推荐主色（SKIN_PRESETS[].accent），custom 沿用 settings.accent；
 *   既有依赖（PiLogoCanvas / CodeMirror / sonner）按 data-theme / data-accent 刷新。
 */
export function applyAppearanceAttributes(
	root: HTMLElement,
	settings: AppearanceSettings,
	systemPrefersDark: boolean,
) {
	const resolvedTheme = resolveAppColorScheme({
		theme: settings.theme,
		themeScheduleLightStart: settings.themeScheduleLightStart,
		themeScheduleDarkStart: settings.themeScheduleDarkStart,
		systemPrefersDark,
	});
	// 兜底到浙水品牌基线：真实设置从主进程回填时 themeSkin 可能缺省（旧配置文件无此字段），
	// 若直接写入 undefined，data-appearance 会失配所有 [data-appearance] 块、整套品牌 token
	// 退回 foundation :root 默认（浅侧栏等），品牌视觉全失效。缺省一律按 classic-green 渲染。
	const skin = settings.themeSkin || "classic-green";
	// 品牌视觉规范只提供浅色方案；保留用户原主题偏好，但 classic-green 渲染固定为浅色。
	root.dataset.theme = skin === "classic-green" ? "light" : resolvedTheme;
	root.dataset.appearance = skin;
	const skinPreset = SKIN_PRESETS.find((p) => p.id === skin);
	const effectiveAccent =
		skin === "custom" || !skinPreset ? settings.accent : skinPreset.accent;
	root.dataset.accent = effectiveAccent;
}
