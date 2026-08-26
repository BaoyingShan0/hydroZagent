import { cn } from "../../lib/utils";

/**
 * hydroZagent 品牌徽标：外轮廓取水滴，内部用三道江河水纹构成字母 Z 的走势。
 * 图形刻意保持少节点和高反差，兼顾 16px 标题栏与大尺寸启动页。
 */
export function HydroBrandMark(props: {
  size?: number;
  className?: string;
  label?: string;
}) {
  const size = props.size ?? 32;
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={cn("shrink-0", props.className)}
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
    >
      <rect width="120" height="120" rx="28" fill="var(--hydro-qing, #5b6a76)" />
      <path
        d="M60 18c-13 18-29 34-29 54a29 29 0 0 0 58 0c0-20-16-36-29-54Z"
        fill="none"
        stroke="var(--hydro-rice, #f7f8f7)"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path
        d="M40 61c9-7 18-7 27 0s18 7 27 0M36 73c10-7 20-7 30 0s20 7 30 0M41 85c8-5 16-5 24 0s16 5 24 0"
        fill="none"
        stroke="var(--hydro-rice, #f7f8f7)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="60" cy="45" r="4" fill="var(--hydro-vermilion, #c94f45)" />
    </svg>
  );
}
