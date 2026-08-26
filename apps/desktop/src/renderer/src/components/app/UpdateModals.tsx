import { t } from "../../i18n";
import type { ReactNode } from "react";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "../ui-shadcn/dialog";
import { Button } from "../ui-shadcn/button";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * 更新结果弹窗：外壳为 shadcn Dialog（small 尺寸，兼容 AGENTS.md 弹框规范），内部排版类保留。
 */
function UpdateResultShell(props: {
	title: string;
	onClose: () => void;
	children: ReactNode;
}) {
	return (
		<Dialog open onOpenChange={(next) => !next && props.onClose()}>
			<DialogContent
				showCloseButton={false}
				className={cn("flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(480px,calc(100vw-48px))]")}
			>
				<DialogHeader className="flex-row items-center justify-between px-4 py-3">
					<DialogTitle>{props.title}</DialogTitle>
					<DialogClose asChild>
						<Button variant="ghost" size="icon" aria-label={t("common.close")} title={t("common.close")}>
							<X size={18} strokeWidth={2.2} aria-hidden="true" />
						</Button>
					</DialogClose>
				</DialogHeader>
				{props.children}
			</DialogContent>
		</Dialog>
	);
}

export function UpdateErrorModal(props: {
	message: string;
	releasesUrl: string;
	onClose: () => void;
	onOpenRelease: () => void;
}) {
	return (
		<UpdateResultShell title={t("update.checkFailedTitle")} onClose={props.onClose}>
			<div className="update-body">
				<p className="update-version-line">
					{t("update.checkFailedDescription")}
				</p>
				<div className="update-error-detail">
					{t("update.errorInfo", { message: props.message })}
				</div>
				<p className="update-asset-line">
					{t("update.manualReleaseHint")}
					<br />
					<span>{props.releasesUrl}</span>
				</p>
			</div>
			<div className="update-actions">
				<Button variant="ghost" onClick={props.onClose}>{t("common.close")}</Button>
				<Button variant="default" onClick={props.onOpenRelease}>
					{t("update.openReleasePage")}
				</Button>
			</div>
		</UpdateResultShell>
	);
}

export function UpToDateModal(props: {
	version: string;
	releasesUrl: string;
	onClose: () => void;
	onOpenRelease: () => void;
}) {
	return (
		<UpdateResultShell title={t("update.upToDateTitle")} onClose={props.onClose}>
			<div className="update-body">
				<p className="update-version-line">
					{t("update.upToDateMessage", { version: props.version })}
				</p>
			</div>
			<div className="update-actions">
				<Button variant="ghost" onClick={props.onClose}>{t("common.close")}</Button>
				<Button variant="secondary" onClick={props.onOpenRelease}>
					{t("update.openReleasePage")}
				</Button>
			</div>
		</UpdateResultShell>
	);
}
