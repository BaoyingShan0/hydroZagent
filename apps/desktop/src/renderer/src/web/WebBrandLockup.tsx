/**
 * WebBrandLockup — Web 端品牌区（与桌面 AppParts.BrandLockup 同视觉）。
 *
 * 不直接复用 AppParts.BrandLockup，避免把桌面端整棵组件树拖进 Web 包；
 * 仅复用自包含的浙水智能体母标与 i18n 品牌名。
 */
import { HydroBrandMark } from "../components/app/HydroBrandMark";
import { t } from "../i18n";

export function WebBrandLockup() {
	return (
		<div className="brand-lockup flex h-9 min-w-0 items-center gap-2.5" aria-label={t("app.logoLabel")}>
			<HydroBrandMark size={22} className="rounded-md shadow-sm" />
			<span
				className="brand-wordmark truncate text-[15px] font-semibold tracking-[0.08em] text-[#294853] dark:text-[#dceef2]"
				aria-hidden="true"
			>
				{t("app.brandName")}
			</span>
		</div>
	);
}
