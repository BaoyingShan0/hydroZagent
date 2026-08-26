import { useState } from "react";
import type { AgentTab, SessionSummary } from "../../../shared/types";
import { t } from "../i18n";

export interface UseRenameApi {
  renameAgent: (id: string, name: string) => Promise<AgentTab>;
  renameSession: (id: string, name: string) => Promise<unknown>;
  showToast: (message: string, duration?: number) => void;
  refreshProjectSessions: (projectId: string, force?: boolean) => Promise<unknown>;
  /** Optional: close agent context menu before opening rename dialog. */
  closeAgentMenu?: () => void;
}

type AgentRenameModalProps = {
  isAgent: boolean;
  value: string;
  saving: boolean;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function useRename(api: UseRenameApi) {
  const [agentRenameTarget, setAgentRenameTarget] = useState<AgentTab | null>(null);
  const [sessionRenameTarget, setSessionRenameTarget] = useState<{
    projectId: string;
    session: SessionSummary;
  } | null>(null);
  const [agentRenameValue, setAgentRenameValue] = useState("");
  const [agentRenaming, setAgentRenaming] = useState(false);

  function openAgentRename(agent: AgentTab) {
    api.closeAgentMenu?.();
    setAgentRenameTarget(agent);
    setSessionRenameTarget(null);
    setAgentRenameValue(agent.title);
  }

  function openSessionRename(projectId: string, session: SessionSummary) {
    setAgentRenameTarget(null);
    setSessionRenameTarget({ projectId, session });
    setAgentRenameValue(session.name || t("common.untitled"));
  }

  async function submitAgentRename() {
    if (!agentRenameTarget) return;
    const name = agentRenameValue.replace(/\s+/g, " ").trim();
    if (!name) {
      api.showToast(t("app.sessionNameRequired"), 2200);
      return;
    }
    setAgentRenaming(true);
    try {
      const tab = await api.renameAgent(agentRenameTarget.id, name);
      setAgentRenameTarget(null);
      setSessionRenameTarget(null);
      setAgentRenameValue("");
      api.showToast(t("app.sessionRenamed"), 2200);
      await api.refreshProjectSessions(tab.projectId);
    } catch (error) {
      api.showToast(
        t("app.sessionRenameFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
        4000,
      );
    } finally {
      setAgentRenaming(false);
    }
  }

  async function submitSessionRename() {
    if (!sessionRenameTarget) return;
    const name = agentRenameValue.replace(/\s+/g, " ").trim();
    if (!name) {
      api.showToast(t("app.sessionNameRequired"), 2200);
      return;
    }
    setAgentRenaming(true);
    try {
      await api.renameSession(sessionRenameTarget.session.id, name);
      await api.refreshProjectSessions(sessionRenameTarget.projectId);
      setSessionRenameTarget(null);
      setAgentRenameValue("");
      api.showToast(t("app.sessionRenamed"), 2200);
    } catch (error) {
      api.showToast(
        t("app.sessionRenameFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
        4000,
      );
    } finally {
      setAgentRenaming(false);
    }
  }

  const renameModalsProps: { agentRename?: AgentRenameModalProps } = {
    agentRename: (agentRenameTarget || sessionRenameTarget) ? {
      isAgent: !!agentRenameTarget,
      value: agentRenameValue,
      saving: agentRenaming,
      onValueChange: setAgentRenameValue,
      onClose: () => { setAgentRenameTarget(null); setSessionRenameTarget(null); },
      onSubmit: () => { if (agentRenameTarget) void submitAgentRename(); else void submitSessionRename(); },
    } : undefined,
  };

  return {
    agentRenameTarget,
    sessionRenameTarget,
    agentRenameValue,
    agentRenaming,
    openAgentRename,
    openSessionRename,
    submitAgentRename,
    submitSessionRename,
    renameModalsProps,
  };
}
