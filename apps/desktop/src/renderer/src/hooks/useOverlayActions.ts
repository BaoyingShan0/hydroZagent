import { useState, useCallback, useMemo } from "react";
import { t } from "../i18n";
import { desktopApi as api } from "../desktopApi";
import type { Project, AppInfo } from "../../../shared/types";

interface ConfirmDialogConfig {
  title: string;
  message: string;
  onConfirm: () => void;
  danger?: boolean;
  confirmLabel?: string;
}

interface TrustRequest {
  requestId: string;
  cwd: string;
  projectName: string;
}

interface UseOverlayActionsParams {
  activeProject?: Project;
  appInfo: AppInfo;
  showToast: (message: string, duration?: number) => void;
}

export function useOverlayActions({ activeProject, appInfo, showToast }: UseOverlayActionsParams) {
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogConfig | null>(null);
  const [trustRequest, setTrustRequest] = useState<TrustRequest | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const showConfirm = useCallback((config: ConfirmDialogConfig) => setConfirmDialog(config), []);
  const clearConfirm = useCallback(() => setConfirmDialog(null), []);

  const overlayProps = useMemo(() => ({
    feedback: feedbackOpen ? {
      open: true as const,
      project: activeProject,
      appInfo,
      onClose: () => setFeedbackOpen(false),
      onCopy: () => showToast(t("app.feedbackCopied")),
      onOpenExternal: (url: string) => api.app.openExternal(url),
      loadEnvironment: api.app.feedbackEnvironment,
    } : undefined,
    confirm: confirmDialog ? {
      open: true as const,
      props: {
        title: confirmDialog.title,
        message: confirmDialog.message,
        onConfirm: confirmDialog.onConfirm,
        onCancel: () => setConfirmDialog(null),
        danger: confirmDialog.danger,
        confirmLabel: confirmDialog.confirmLabel,
      },
    } : undefined,
    trust: trustRequest ? {
      open: true as const,
      requestId: trustRequest.requestId,
      cwd: trustRequest.cwd,
      projectName: trustRequest.projectName,
      onChoose: (choice: "trust-remember" | "trust-session" | "deny") => {
        api.projects.respondTrustRequest(trustRequest.requestId, choice);
        setTrustRequest(null);
      },
    } : undefined,
  }), [feedbackOpen, activeProject, appInfo, confirmDialog, trustRequest, showToast]);

  return {
    confirmDialog,
    showConfirm,
    clearConfirm,
    trustRequest,
    setTrustRequest,
    feedbackOpen,
    setFeedbackOpen,
    overlayProps,
  };
}
