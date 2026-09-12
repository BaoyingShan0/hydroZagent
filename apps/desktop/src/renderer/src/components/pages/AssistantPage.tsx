import { Users, ArrowLeft } from "lucide-react";
import { t } from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "../ui-shadcn/button";

interface AssistantPageProps {
  onNavigate: (page: string | undefined) => void;
  onModuleClick: (module: string) => void;
}

/** 业务助手模块定义 */
const modules = [
  {
    id: "zhicheng",
    label: "职称审查",
    icon: "📋",
    description: "逐人审查申报材料，生成标准化审核台账",
  },
  // 未来在这里添加更多模块...
];

export function AssistantPage({ onNavigate, onModuleClick }: AssistantPageProps) {
  return (
    <div className="flex h-full w-full flex-col" style={{ background: "var(--color-bg-app)" }}>
      {/* 顶部导航栏 */}
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
        <span className="text-sm font-medium text-foreground">{t("assistant.pageTitle")}</span>
      </div>

      {/* 页面内容区 */}
      <div className="relative flex min-h-0 flex-1 flex-col items-center overflow-auto p-8">
        <div className="relative z-10 flex flex-col items-center gap-8 text-center" style={{ maxWidth: 640 }}>
          {/* 头部 */}
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
              <Users className="size-8 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-foreground">
                {t("assistant.pageTitle")}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("assistant.pageDescription")}
              </p>
            </div>
          </div>

          {/* 模块卡片列表 */}
          <div className="w-full space-y-3">
            {modules.map((mod) => (
              <button
                key={mod.id}
                type="button"
                onClick={() => onModuleClick(mod.id)}
                className={cn(
                  "flex w-full items-center gap-4 rounded-xl border border-border/40 bg-card p-5 text-left transition-all duration-200 hover:border-primary/30 hover:shadow-sm",
                )}
              >
                <span className="text-3xl">{mod.icon}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{mod.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{mod.description}</p>
                </div>
                <div className="text-muted-foreground/40">›</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}