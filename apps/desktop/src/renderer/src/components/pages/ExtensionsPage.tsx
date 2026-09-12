import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { desktopApi } from "../../desktopApi";
import { showNotice } from "../../utils/notice";
import { ExtensionsTab } from "../../config/ExtensionsTab";
import type { PiExtensionListResult, PiExtensionSummary } from "../../../../shared/types";

interface ExtensionsPageProps {
  onNavigate: (page: string | undefined) => void;
}

export function ExtensionsPage({ onNavigate }: ExtensionsPageProps) {
  const [data, setData] = useState<PiExtensionListResult>({ extensions: [], raw: "" });
  const [loading, setLoading] = useState(true);
  const [uninstallingSource, setUninstallingSource] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const result = await desktopApi.extensions.list();
      setData(result);
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : t("extensions.uploadFailed"),
        4000,
        "error",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleUninstall = async (extension: PiExtensionSummary) => {
    setUninstallingSource(extension.source);
    try {
      await desktopApi.extensions.uninstall(extension.source, extension.scope);
      await refresh();
      showNotice(t("app.sessionDeleted"), 3000);
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : t("extensions.uploadFailed"),
        4000,
        "error",
      );
    } finally {
      setUninstallingSource(null);
    }
  };

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
        <span className="text-sm font-medium text-foreground">{t("extensions.pageTitle")}</span>
      </div>

      {/* 页面内容区：扩展管理面板 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <ExtensionsTab
          data={data}
          loading={loading}
          uninstallingSource={uninstallingSource}
          onRefresh={() => void refresh()}
          onUninstall={handleUninstall}
        />
      </div>
    </div>
  );
}