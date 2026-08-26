import { CloudRain, Droplets, Gauge, Waves } from "lucide-react";
import { t } from "../../i18n";
import { LogoMark } from "./SurfaceParts";

const CAPABILITIES = [
  { key: "hydro.term.hydrology" as const, icon: Droplets },
  { key: "hydro.term.waterRegime" as const, icon: Waves },
  { key: "hydro.term.rainfall" as const, icon: CloudRain },
  { key: "hydro.term.flow" as const, icon: Gauge },
];

/** 新会话页品牌标题区：让通用 Agent 工作台一眼落到浙江水利业务语境。 */
export function HydroWelcomeHeader() {
  return (
    <div className="relative z-10 flex max-w-[760px] flex-col items-center text-center">
      <LogoMark size={68} />
      <div className="mt-5 flex items-baseline gap-2">
        <h1 className="text-[26px] font-semibold tracking-[0.04em] text-text-primary">
          {t("hydro.welcome.title")}
        </h1>
        <span className="hidden text-[10px] font-semibold tracking-[0.2em] text-[#5f8792] uppercase sm:inline">
          hydroZagent
        </span>
      </div>
      <p hidden className="mt-2 text-sm tracking-[0.08em] text-text-secondary">
        {t("hydro.welcome.tagline")}
      </p>
      <div
        hidden
        className="mt-4 flex flex-wrap justify-center gap-2"
        aria-label={t("hydro.welcome.capabilities")}
      >
        {CAPABILITIES.map(({ key, icon: Icon }) => (
          <span
            key={key}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#bcd6dc]/80 bg-white/55 px-3 text-[11px] font-medium text-[#456975] shadow-[0_1px_8px_rgba(54,87,99,0.05)] backdrop-blur-sm dark:border-[#3f6069] dark:bg-[#20343a]/70 dark:text-[#b8d2d9]"
          >
            <Icon size={12} strokeWidth={1.8} aria-hidden="true" />
            {t(key)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 江南水系背景纹样；纯 SVG、低对比，不引入额外图片资源。 */
export function HydroWelcomeBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-x-0 top-0 h-[58%] bg-[radial-gradient(circle_at_50%_0%,rgba(111,175,192,0.16),transparent_66%)] dark:bg-[radial-gradient(circle_at_50%_0%,rgba(111,175,192,0.12),transparent_66%)]" />
      <svg className="absolute inset-x-0 bottom-0 h-[48%] w-full opacity-55 dark:opacity-25" viewBox="0 0 1200 360" preserveAspectRatio="none">
        <path d="M0 218C128 158 205 190 308 128c83-50 151-48 232 12 88 65 163 36 254-20 105-64 176-47 406 82v158H0Z" fill="#dcebef" />
        <path d="M0 258c153-52 252-20 377-56 134-38 230-29 360 20 123 47 237 31 463-22v160H0Z" fill="#edf5f6" />
        <path d="M0 286c219-30 340 17 525-11 173-26 344 40 675-9" fill="none" stroke="#6fafc0" strokeWidth="2" strokeDasharray="10 14" opacity=".42" />
      </svg>
    </div>
  );
}
