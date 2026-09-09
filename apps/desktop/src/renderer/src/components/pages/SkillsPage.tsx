import { useCallback, useEffect, useState } from "react";
import { Upload, BookOpen, ArrowLeft, Loader2 } from "lucide-react";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { Textarea } from "../ui-shadcn/textarea";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "../ui-shadcn/dialog";
import { ConfirmDialog } from "../ui-shadcn/ConfirmDialog";
import { SkillsTab } from "../../config/SkillsTab";
import { desktopApi } from "../../desktopApi";
import { showNotice } from "../../utils/notice";
import type {
	PiSkillImportResult,
	PiSkillListResult,
	PiSkillLocation,
	PiSkillSummary,
} from "../../../../shared/types";

interface SkillsPageProps {
	onNavigate: (page: string | undefined) => void;
}

const EMPTY_DATA: PiSkillListResult = { locations: [], skills: [] };

/** 从路径中取文件名（兼容 win32 反斜杠），用于导入结果展示 */
function basenameOf(p: string): string {
	return p.split(/[\\/]/).pop() ?? p;
}

export function SkillsPage({ onNavigate }: SkillsPageProps) {
	const [data, setData] = useState<PiSkillListResult>(EMPTY_DATA);
	const [loading, setLoading] = useState(true);
	const [creating, setCreating] = useState(false);
	const [importing, setImporting] = useState(false);
	const [newName, setNewName] = useState("");
	const [newDescription, setNewDescription] = useState("");
	const [newLocationId, setNewLocationId] = useState<PiSkillLocation["id"]>("pi-global");
	const [deleteTarget, setDeleteTarget] = useState<PiSkillSummary | null>(null);
	// SKILL.md 编辑器
	const [editing, setEditing] = useState<PiSkillSummary | null>(null);
	const [editContent, setEditContent] = useState("");
	const [editLoading, setEditLoading] = useState(false);
	const [editSaving, setEditSaving] = useState(false);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const result = await desktopApi.skills.list();
			setData(result);
		} catch (error) {
			showNotice(
				error instanceof Error ? error.message : t("skills.uploadFailed"),
				4000,
				"error",
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// 新建表单的目标目录默认跟随第一个技能位置（与 ConfigModal 行为一致）
	useEffect(() => {
		const first = data.locations[0];
		if (first && !data.locations.some((item) => item.id === newLocationId)) {
			setNewLocationId(first.id);
		}
	}, [data, newLocationId]);

	const handleCreate = async () => {
		if (!newName.trim() || !newDescription.trim()) return;
		setCreating(true);
		try {
			await desktopApi.skills.create({
				name: newName,
				description: newDescription,
				locationId: newLocationId,
			});
			setNewName("");
			setNewDescription("");
			await refresh();
			showNotice(t("config.skillCreatedToast"), 3000, "info");
		} catch (error) {
			showNotice(
				error instanceof Error ? error.message : t("skills.uploadFailed"),
				4000,
				"error",
			);
		} finally {
			setCreating(false);
		}
	};

	const handleToggle = async (skill: PiSkillSummary, enabled: boolean) => {
		try {
			await desktopApi.skills.toggle(skill.path, enabled);
			await refresh();
			showNotice(
				t(enabled ? "config.skillEnabledToast" : "config.skillDisabledToast"),
				3000,
				"info",
			);
		} catch (error) {
			showNotice(
				error instanceof Error ? error.message : t("skills.uploadFailed"),
				4000,
				"error",
			);
		}
	};

	const confirmDelete = async () => {
		const target = deleteTarget;
		setDeleteTarget(null);
		if (!target) return;
		try {
			await desktopApi.skills.delete(target.path);
			await refresh();
			showNotice(t("config.skillDeletedToast"), 3000, "info");
		} catch (error) {
			showNotice(
				error instanceof Error ? error.message : t("skills.uploadFailed"),
				4000,
				"error",
			);
		}
	};

	const handleRename = async (skill: PiSkillSummary, newName: string) => {
		try {
			await desktopApi.skills.rename(skill.path, newName);
			await refresh();
			showNotice(t("config.skillRenamedToast"), 3000, "info");
		} catch (error) {
			showNotice(
				error instanceof Error ? error.message : t("skills.uploadFailed"),
				4000,
				"error",
			);
		}
	};

	/** 右上角 +：选择 zip 并真实导入到全局技能目录 */
	const handleImportZip = async () => {
		try {
			const filePaths = await desktopApi.dialog.pickFiles({
				title: t("skills.selectSkills"),
			});
			if (!filePaths || filePaths.length === 0) return;
			setImporting(true);
			const results: PiSkillImportResult[] = await desktopApi.skills.importZip(
				filePaths,
				"pi-global",
			);
			const imported = results.filter((item) => item.status === "imported");
			const skipped = results.filter((item) => item.status === "skipped");
			const failed = results.filter((item) => item.status === "failed");
			showNotice(
				t("skills.importDone", {
					imported: imported.length,
					skipped: skipped.length,
					failed: failed.length,
				}),
				4000,
				imported.length > 0 ? "info" : "error",
			);
			if (failed.length > 0) {
				showNotice(
					t("skills.importFailedFiles", {
						list: failed
							.map((item) => `${basenameOf(item.file)}: ${item.error ?? ""}`)
							.join("\n"),
					}),
					6000,
					"error",
				);
			}
			await refresh();
		} catch (error) {
			showNotice(
				error instanceof Error ? error.message : t("skills.uploadFailed"),
				4000,
				"error",
			);
		} finally {
			setImporting(false);
		}
	};

	const openEditor = async (skill: PiSkillSummary) => {
		setEditing(skill);
		setEditContent("");
		setEditLoading(true);
		try {
			const content = await desktopApi.files.readContent(skill.path);
			setEditContent(content);
		} catch (error) {
			showNotice(
				error instanceof Error ? error.message : t("skills.uploadFailed"),
				4000,
				"error",
			);
			setEditing(null);
		} finally {
			setEditLoading(false);
		}
	};

	const saveEditor = async () => {
		if (!editing || editSaving) return;
		setEditSaving(true);
		try {
			await desktopApi.files.writeContent(editing.path, editContent);
			await refresh();
			showNotice(t("config.promptSavedHint"), 2000, "info");
			setEditing(null);
		} catch (error) {
			showNotice(
				error instanceof Error ? error.message : t("skills.uploadFailed"),
				4000,
				"error",
			);
		} finally {
			setEditSaving(false);
		}
	};

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
				<span className="text-sm font-medium text-foreground">{t("skills.pageTitle")}</span>
				<div className="ml-auto flex items-center">
					<Button size="sm" className="gap-1.5" onClick={() => void handleImportZip()} disabled={importing}>
						{importing ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Upload className="size-4" />
						)}
						{importing ? t("skills.importing") : t("skills.uploadSkill")}
					</Button>
				</div>
			</div>

			{/* 页面内容区：真实技能管理面板（复用配置弹窗的 SkillsTab） */}
			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
				{!loading && data.skills.length === 0 && (
					<div className="mb-6 flex flex-col items-center gap-3 text-center">
						<div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10">
							<BookOpen className="size-7 text-primary" />
						</div>
						<div>
							<h2 className="text-xl font-semibold text-foreground">{t("skills.pageTitle")}</h2>
							<p className="mt-1 text-sm text-muted-foreground">{t("skills.pageDescription")}</p>
						</div>
					</div>
				)}
				<SkillsTab
					data={data}
					loading={loading}
					creating={creating}
					newName={newName}
					newDescription={newDescription}
					newLocationId={newLocationId}
					onRefresh={() => void refresh()}
					onOpenRoot={() => void desktopApi.skills.openFolder()}
					onChangeNewName={setNewName}
					onChangeNewDescription={setNewDescription}
					onChangeNewLocation={setNewLocationId}
					onCreate={() => void handleCreate()}
					onToggle={(skill, enabled) => void handleToggle(skill, enabled)}
					onDelete={setDeleteTarget}
					onEdit={(skill) => void openEditor(skill)}
					onRename={handleRename}
				/>
			</div>

			{deleteTarget && (
				<ConfirmDialog
					danger
					title={t("config.deleteSkillConfirmTitle")}
					message={
						t("config.deleteSkillConfirmBody", { name: deleteTarget.name }) +
						"\n" +
						deleteTarget.path
					}
					onConfirm={() => void confirmDelete()}
					onCancel={() => setDeleteTarget(null)}
				/>
			)}

			{/* SKILL.md 编辑器 */}
			<Dialog
				open={!!editing}
				onOpenChange={(open) => {
					if (!open) setEditing(null);
				}}
			>
				<DialogContent className="max-w-3xl">
					<DialogHeader>
						<DialogTitle>{t("skills.editTitle", { name: editing?.name ?? "" })}</DialogTitle>
					</DialogHeader>
					{editLoading ? (
						<div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							{t("common.loading")}
						</div>
					) : (
						<Textarea
							value={editContent}
							onChange={(event) => setEditContent(event.target.value)}
							className="min-h-[50vh] resize-y font-mono text-xs"
							disabled={editSaving}
						/>
					)}
					<div className="flex items-center justify-end gap-2">
						<Button variant="outline" size="sm" onClick={() => setEditing(null)}>
							{t("common.cancel")}
						</Button>
						<Button size="sm" onClick={() => void saveEditor()} disabled={editSaving || editLoading}>
							{editSaving ? t("common.loading") : t("common.save")}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
