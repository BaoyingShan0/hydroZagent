import { Users, Bot, ArrowLeft } from "lucide-react";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";

interface ExpertsPageProps {
  onNavigate: (page: string | undefined) => void;
}

export function ExpertsPage({ onNavigate }: ExpertsPageProps) {
  return (
    <div className="flex h-full w-full flex-col" style={{ background: "var(--color-bg-app)" }}>
      {/* 顶部导航栏：page-topbar 盖过 window-drag-layer，否则返回箭头点击被拖拽层吞掉 */}
      <div className="page-topbar flex h-12 shrink-0 items-center gap-2 border-b border-border/30 bg-card/90 px-4">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 rounded-lg p-0"
          onClick={() => onNavigate(undefined)}
          title={t("common.back")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <span className="text-sm font-medium text-foreground">{t("experts.pageTitle")}</span>
      </div>

      {/* 页面内容区 */}
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden">
        {/* 中央欢迎内容 */}
        <div className="relative z-10 flex flex-col items-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
            <Bot className="size-8 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-foreground">
              {t("experts.pageTitle")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("experts.pageDescription")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}