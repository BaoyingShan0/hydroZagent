/**
 * web-main — PiDeck Web 服务 React 入口（A2）。
 * 独立于主窗口 renderer；通过 /api/* 与主进程 WebServiceManager 通信。
 *
 * 重构后与桌面端共享同一套样式基座（styles.css → foundation/timeline/surfaces/
 * tailwind token）。局域网 Web 与桌面端共用浙水品牌浅色规范。
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./web/web.css";
import { setI18nLocale } from "./i18n";
import { resolveLocale } from "./i18n";
import { WebChatApp } from "./web/WebChatApp";

// 与桌面端一致的 locale 解析：优先浏览器语言，中文走 zh-CN
setI18nLocale(resolveLocale("system"));
document.documentElement.lang = resolveLocale("system") === "zh-CN" ? "zh-CN" : "en-US";

document.documentElement.dataset.appearance = "classic-green";
document.documentElement.dataset.accent = "default";
document.documentElement.dataset.theme = "light";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WebChatApp />
  </StrictMode>,
);
