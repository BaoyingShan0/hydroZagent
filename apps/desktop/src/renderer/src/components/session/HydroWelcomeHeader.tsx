import { CloudRain, Droplets, Gauge, Waves } from "lucide-react";
import { t } from "../../i18n";
import welcomeBackdrop from "../../assets/brand/welcome-backdrop.png";
import welcomeLogo from "../../assets/brand/hydrozagent-logo.png";

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
      <img
        src={welcomeLogo}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="h-auto w-[148px] max-w-[44vw] select-none object-contain mix-blend-multiply"
      />
      <h1 className="mt-4 font-brand text-[30px] leading-[42px] font-semibold tracking-[0.02em] text-text-primary">
        {t("hydro.welcome.title")}
      </h1>
      <p className="mt-3 font-brand text-[15px] leading-[24px] font-normal tracking-[0.06em] text-text-secondary">
        {t("hydro.welcome.tagline")}
      </p>
      <span className="mt-2.5 font-brand text-caption font-normal tracking-[0.22em] text-text-tertiary uppercase">
        hydroZagent
      </span>
      <div
        hidden
        className="mt-4 flex flex-wrap justify-center gap-2"
        aria-label={t("hydro.welcome.capabilities")}
      >
        {CAPABILITIES.map(({ key, icon: Icon }) => (
          <span
            key={key}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border-default bg-bg-panel px-3 text-caption font-normal text-text-secondary"
          >
            <Icon size={12} strokeWidth={1.8} aria-hidden="true" />
            {t(key)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * 江南水系背景：底部铺《浙水智能体整体设计方案》配套的水墨流水底图
 * （青碧湖蓝渐隐 + AI 数据流意象），顶部自然融进米白留白，呼应「留白为境」。
 *
 * 用视口相对高度 + object-cover 贴底，让引导页与真实会话起始页（容器高度不同）
 * 里水纹落点一致；顶部再叠一层渐隐蒙版，无论裁切与否都柔和融进米白，不出硬边。
 */
export function HydroWelcomeBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
      <img
        src={welcomeBackdrop}
        alt=""
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[42vh] w-full select-none object-cover object-bottom opacity-40 [mask-image:linear-gradient(to_bottom,transparent_0%,#000_38%)]"
      />
    </div>
  );
}
