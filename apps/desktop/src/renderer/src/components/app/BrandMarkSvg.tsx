import { HydroBrandMark } from "./HydroBrandMark";

/** 兼容旧导入名的浙水智能体矢量母标。 */
export function BrandMarkSvg(props: { className?: string; size?: number }) {
	return (
		<HydroBrandMark size={props.size ?? 120} className={props.className} />
	);
}
