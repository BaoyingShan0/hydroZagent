import { Upload, Package, ArrowLeft } from "lucide-react";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { desktopApi } from "../../desktopApi";
import { showNotice } from "../../utils/notice";

interface ExtensionsPageProps {
  onNavigate: (page: string | undefined) => void;
}

export function ExtensionsPage({ onNavigate }: ExtensionsPageProps) {
  async function handleUploadExtensions() {
    try {
      const filePaths = await desktopApi.dialog.pickFiles({
        title: t("extensions.selectPlugins"),
      });

      if (!filePaths || filePaths.length === 0) return;

      showNotice(
        t("extensions.uploadSuccess", { count: filePaths.length }),
        3000,
        "info",
      );
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : t("extensions.uploadFailed"),
        4000,
        "error",
      );
    }
  }

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
        <span className="text-sm font-medium text-foreground">{t("extensions.pageTitle")}</span>
      </div>

      {/* 页面内容区 */}
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden">
        {/* 右上角上传按钮 */}
        <div className="absolute right-6 top-6 z-10">
          <Button
            size="lg"
            className="h-10 w-10 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90"
            onClick={handleUploadExtensions}
            title={t("extensions.uploadPlugin")}
            aria-label={t("extensions.uploadPlugin")}
          >
            <Upload className="size-5" />
          </Button>
        </div>

        {/* 中央欢迎内容 */}
        <div className="relative z-10 flex flex-col items-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
            <Package className="size-8 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-foreground">
              {t("extensions.pageTitle")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("extensions.pageDescription")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}