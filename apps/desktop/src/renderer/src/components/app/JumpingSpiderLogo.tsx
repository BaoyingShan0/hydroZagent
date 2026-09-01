/**
 * 兼容旧组件名的浙水智能体品牌图片，与系统图标同源（build/brand/logo.png）。
 *
 * 保留导出名是为了兼容旧导入；实际资源已经统一为水滴与江河水纹母标。
 * 资源走 Vite 打包（`new URL`），不要内联 1024 的 data-URI。
 */
import { brandMarkSrc } from "./brandMark";

export function JumpingSpiderLogo(props: { className?: string }) {
	return (
		<img
			src={brandMarkSrc}
			alt=""
			className={props.className}
			aria-hidden="true"
			draggable={false}
		/>
	);
}
