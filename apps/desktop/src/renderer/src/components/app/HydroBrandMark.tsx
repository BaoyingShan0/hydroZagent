import { cn } from "../../lib/utils";
import { brandMarkSrc } from "./brandMark";

/**
 * 浙水智能体品牌标：统一渲染产品主标（swoosh + 小机器人）的白底方块，
 * 与任务栏/托盘系统图标同源（均由 build/brand/logo.png 经 make-icon 生成）。
 * 圆角、描边、投影交给调用方 className；小到 16px 标题栏、大到启动页同一枚图。
 */
export function HydroBrandMark(props: {
  size?: number;
  className?: string;
  label?: string;
}) {
  const size = props.size ?? 32;
  return (
    <img
      src={brandMarkSrc}
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", props.className)}
      alt={props.label ?? ""}
      aria-hidden={props.label ? undefined : true}
      draggable={false}
    />
  );
}
