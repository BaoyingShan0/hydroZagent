import { t } from "../i18n";
import { isComposingKeyboardEvent } from "../composerBehavior";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui-shadcn/dialog";
import { Button } from "./ui-shadcn/button";
import { Input } from "./ui-shadcn/input";

/**
 * 重命名对话框（#115 U5）：统一为 shadcn Dialog + Input + Button。
 * 调用方按条件渲染（{x && <RenameModals/>}），组件挂载即打开；
 * ESC/遮罩关闭走 onClose（agent 保存中禁用关闭，防中途丢状态）。
 */

type FileRenameProps = {
  path: string;
  name: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onClose: () => void;
  onConfirm: (path: string, newName: string) => void;
};

type AgentRenameProps = {
  isAgent: boolean;
  value: string;
  saving: boolean;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

type Props = {
  fileRename?: FileRenameProps;
  agentRename?: AgentRenameProps;
};

export function RenameModals({ fileRename, agentRename }: Props) {
  // 文件重命名的确认语义：非空且与原名不同才提交，否则视为取消
  const submitFileRename = () => {
    if (!fileRename) return;
    const next = fileRename.inputValue.trim();
    if (next && next !== fileRename.name) fileRename.onConfirm(fileRename.path, next);
    else fileRename.onClose();
  };

  return <>
    {agentRename && (
      <Dialog open onOpenChange={(open) => { if (!open && !agentRename.saving) agentRename.onClose(); }}>
        <DialogContent
          className="sm:max-w-sm"
          onOpenAutoFocus={(event) => {
            // 默认 autofocus 第一个可聚焦元素是关闭按钮；改为聚焦输入框
            event.preventDefault();
            const root = event.currentTarget as HTMLElement | null;
            root?.querySelector("input")?.focus();
          }}
          onKeyDown={(e) => {
            // Enter 提交（与旧 form 语义一致）；IME 合成中（中文选词）与 saving 中不响应
            if (e.key === "Enter" && !isComposingKeyboardEvent(e) && !agentRename.saving) {
              e.preventDefault();
              agentRename.onSubmit();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("app.renameSessionTitle")}</DialogTitle>
            <DialogDescription className="sr-only">{t("app.renameSessionPlaceholder")}</DialogDescription>
          </DialogHeader>
          <Input
            value={agentRename.value}
            onChange={(e) => agentRename.onValueChange(e.target.value)}
            placeholder={t("app.renameSessionPlaceholder")}
            disabled={agentRename.saving}
          />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={agentRename.saving} onClick={agentRename.onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="button" disabled={agentRename.saving} onClick={agentRename.onSubmit}>
              {agentRename.saving ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}
    {fileRename && (
      <Dialog open onOpenChange={(open) => { if (!open) fileRename.onClose(); }}>
        <DialogContent
          className="sm:max-w-sm"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const root = event.currentTarget as HTMLElement | null;
            root?.querySelector("input")?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isComposingKeyboardEvent(e)) {
              e.preventDefault();
              submitFileRename();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("drawer.renameTitle")}</DialogTitle>
            <DialogDescription className="sr-only">{fileRename.name}</DialogDescription>
          </DialogHeader>
          <Input
            value={fileRename.inputValue}
            onChange={(e) => fileRename.onInputChange(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={fileRename.onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={() => submitFileRename()}>{t("common.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}
  </>;
}
