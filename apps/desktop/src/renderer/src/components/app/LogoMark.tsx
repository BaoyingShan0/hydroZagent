import { t } from "../../i18n";
import { HydroBrandMark } from "./HydroBrandMark";

/**
 * 浙水智能体品牌标。默认 32（错误页）；起始页 / 空态可放大。
 * 独立成文件，避免 Web 空态为了 LogoMark 拖进整棵会话组件树。
 */
export function LogoMark({ size = 32 }: { size?: number } = {}) {
	return (
		<HydroBrandMark
			size={size}
			label={t("app.logoLabel")}
			className="logo-mark rounded-[22%] shadow-[0_10px_26px_rgba(54,87,99,0.18)] ring-1 ring-white/30"
		/>
	);
}
