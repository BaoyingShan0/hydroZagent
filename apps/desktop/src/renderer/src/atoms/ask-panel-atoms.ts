import { atom } from "jotai";

/** 并行问询：结果弹框是否可见 */
export const askPanelOpenAtom = atom(false);
/** 并行问询使用的匿名会话 id（不落盘、不进项目列表，关闭弹框即回收） */
export const askPanelSessionIdAtom = atom<string | null>(null);
/** 匿名会话创建中（发送按钮显示 loading 防重复点击） */
export const askPanelCreatingAtom = atom(false);
