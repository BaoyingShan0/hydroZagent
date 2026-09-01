/**
 * 应用内品牌标资源：与任务栏/托盘系统图标同源的浙水智能体主标（白底方块）。
 *
 * 256px PNG 由 `build/brand/logo.png` 经 `npm run make-icon` 导出（见 scripts/make-icon.js），
 * 圆角交给调用方 CSS。侧栏/空态/来源徽章统一引用这一枚，避免多套品牌标漂移。
 */
export const brandMarkSrc = new URL("../../assets/brand-mark.png", import.meta.url).href;
