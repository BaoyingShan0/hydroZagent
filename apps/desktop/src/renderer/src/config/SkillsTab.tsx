import { Button } from "../components/ui-shadcn/button";
import { Input } from "../components/ui-shadcn/input";
import { Textarea } from "../components/ui-shadcn/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui-shadcn/select";
import { Tabs, TabsList, TabsTrigger } from "../components/ui-shadcn/tabs";
import { Label } from "../components/ui-shadcn/label";
import { useState, useMemo } from "react";
import {
	Sparkles,
	Check,
	X,
	Plus,
	ToggleRight,
	ToggleLeft,
	FileEdit,
	Trash2,
	Search,
	Globe,
	Store,
	ShoppingBag,
	ChevronDown,
	ChevronUp,
	Code2,
	Copy,
	ExternalLink,
	ShieldCheck,
} from "lucide-react";
import type {
	CreatePiSkillInput,
	PiSkillListResult,
	PiSkillLocation,
	PiSkillSummary,
} from "../../../shared/types";
import { t } from "../i18n";
import { SkillStoreTab } from "./SkillStoreTab";
import { SkillHubStorePanel } from "./SkillHubStorePanel";
import { cn } from "../lib/utils";

// ── Skill Card Component ─────────────────────────────────────────────

function SkillCard({
	skill,
	onToggle,
	onDelete,
	onEdit,
	onRename,
}: {
	skill: PiSkillSummary;
	onToggle: (skill: PiSkillSummary, enabled: boolean) => void;
	onDelete: (skill: PiSkillSummary) => void;
	onEdit: (skill: PiSkillSummary) => void;
	onRename: (skill: PiSkillSummary, newName: string) => Promise<void>;
}) {
	const [renaming, setRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState(skill.name);
	const [renameBusy, setRenameBusy] = useState(false);

	const handleRename = async () => {
		if (renameBusy || !renameValue.trim() || renameValue.trim() === skill.name) {
			setRenaming(false);
			return;
		}
		setRenameBusy(true);
		try {
			await onRename(skill, renameValue.trim());
			setRenaming(false);
		} finally {
			setRenameBusy(false);
		}
	};

	return (
		<div
			className={cn(
				"skill-card group relative rounded-xl border border-border-subtle bg-card transition-all duration-300 ease-in-out overflow-hidden",
				skill.enabled ? "shadow-sm" : "opacity-75",
				// 折叠态：显示名称+状态；hover/点击时展开显示详情
				"max-h-[48px] hover:max-h-[520px] p-3 hover:p-4 cursor-pointer hover:border-border hover:shadow-md"
			)}
		>
			{/* Header: name + status + toggle — 始终可见 */}
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					{renaming ? (
						<div className="flex items-center gap-1">
							<Input
								value={renameValue}
								onChange={(e) => setRenameValue(e.target.value)}
								onKeyDown={(e) => { if (e.key === "Enter") void handleRename(); if (e.key === "Escape") setRenaming(false); }}
								autoFocus
								disabled={renameBusy}
								className="h-7 text-sm font-medium"
							/>
							<Button variant="ghost" size="icon-xs" className="size-6" onClick={handleRename} disabled={renameBusy}>
								<Check size={12} strokeWidth={2.5} />
							</Button>
							<Button variant="ghost" size="icon-xs" className="size-6" onClick={() => setRenaming(false)} disabled={renameBusy}>
								<X size={12} strokeWidth={2.5} />
							</Button>
						</div>
					) : (
						<div className="flex items-center gap-2">
							<Sparkles size={14} className="shrink-0 text-accent" />
							<strong
								className="truncate text-sm font-medium text-foreground"
								onDoubleClick={(e) => { e.stopPropagation(); setRenaming(true); setRenameValue(skill.name); }}
								title={t("common.rename")}
							>
								{skill.name}
							</strong>
						</div>
					)}
				</div>
				{/* Status badge + toggle */}
				<div className="flex shrink-0 items-center gap-1.5">
					<span className={cn(
						"skill-badge px-2 py-0.5 rounded-full text-[11px] font-medium",
						skill.enabled ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"
					)}>
						{skill.enabled ? t("common.enabled") : t("common.disabled")}
					</span>
					<Button
						variant="ghost"
						size="icon-xs"
						className="size-6 hover:bg-accent/10 hover:text-accent transition-colors"
						onClick={(e) => { e.stopPropagation(); onToggle(skill, !skill.enabled); }}
						title={skill.enabled ? t("common.disable") : t("common.enabled")}
					>
						{skill.enabled ? <ToggleRight size={14} strokeWidth={2} /> : <ToggleLeft size={14} strokeWidth={2} />}
					</Button>
				</div>
			</div>

			{/* Expandable content — hover 时显示 */}
			<div className="skill-card-expandable mt-0 overflow-hidden">
				{/* Description */}
				<p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
					{skill.description || t("config.skillDescriptionMissing")}
				</p>

				{/* Path */}
				{skill.sourceLabel && (
					<div className="mt-2 flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground/70">
						<Code2 size={10} className="shrink-0" />
						<span className="truncate">{skill.sourceLabel}</span>
					</div>
				)}

				{/* Warnings */}
				{skill.warnings.length > 0 && (
					<div className="mt-2 flex flex-col gap-1">
						{skill.warnings.map((warning) => (
							<span key={warning} className="truncate text-[11px] text-destructive flex items-center gap-1">
								<ShieldCheck size={10} className="shrink-0" />
								{warning}
							</span>
						))}
					</div>
				)}

				{/* Invalid warning */}
				{!skill.valid && (
					<span className="mt-2 inline-block text-[11px] text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
						{t("config.needsFix")}
					</span>
				)}

				{/* Actions bar */}
				<div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
					<span className="text-[10px] text-muted-foreground truncate max-w-[60%] font-mono" title={skill.path}>
						{skill.path}
					</span>
					<div className="flex shrink-0 items-center gap-0.5">
						<Button
							variant="ghost"
							size="icon-xs"
							className="size-7 hover:bg-accent/10 hover:text-accent"
							onClick={(e) => { e.stopPropagation(); onEdit(skill); }}
							title={t("common.edit")}
						>
							<FileEdit size={12} strokeWidth={2} />
						</Button>
						<Button
							variant="ghost"
							size="icon-xs"
							className="size-7 hover:bg-destructive/10 hover:text-destructive"
							onClick={(e) => { e.stopPropagation(); onDelete(skill); }}
							title={t("common.delete")}
						>
							<Trash2 size={12} strokeWidth={2} />
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

// ── Create Skill Inline Form ─────────────────────────────────────────

function CreateSkillForm({
	creating,
	newName,
	newDescription,
	newLocationId,
	data,
	expanded,
	onToggleExpanded,
	onChangeNewName,
	onChangeNewDescription,
	onChangeNewLocation,
	onCreate,
}: {
	creating: boolean;
	newName: string;
	newDescription: string;
	newLocationId: PiSkillLocation["id"];
	data: PiSkillListResult;
	expanded: boolean;
	onToggleExpanded: () => void;
	onChangeNewName: (value: string) => void;
	onChangeNewDescription: (value: string) => void;
	onChangeNewLocation: (value: PiSkillLocation["id"]) => void;
	onCreate: () => void;
}) {
	const selectedLocation =
		data.locations.find((location) => location.id === newLocationId) ??
		data.locations[0];
	const canCreate = newName.trim() && newDescription.trim();

	if (!data.locations.length) return null;

	return (
		<div className="skill-create-section mb-6">
			{/* Toggle button */}
			<button
				type="button"
				onClick={onToggleExpanded}
				className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border-subtle bg-card/50 px-4 py-3 text-left text-sm text-muted-foreground hover:border-accent/50 hover:text-accent transition-all duration-200"
			>
				{expanded ? <ChevronDown size={16} /> : <Plus size={16} />}
				<span className="font-medium">{t("config.createSkill")}</span>
			</button>

			{/* Expandable form */}
			<div className={cn(
				"skill-create-form overflow-hidden transition-all duration-300 ease-in-out",
				expanded ? "max-h-[500px] opacity-100 mt-3" : "max-h-0 opacity-0"
			)}>
				<div className="rounded-xl border border-border-subtle bg-card p-4 space-y-4">
					{/* Name + Location row */}
					<div className="grid grid-cols-[1fr_200px] gap-3">
						<div className="space-y-1.5">
							<Label className="text-xs font-medium text-foreground">{t("config.name")}</Label>
							<Input
								value={newName}
								placeholder={t("config.skillNamePlaceholder")}
								onChange={(event) => onChangeNewName(event.target.value)}
								className="h-9 text-sm"
							/>
						</div>
						<div className="space-y-1.5">
							<Label className="text-xs font-medium text-foreground">{t("config.location")}</Label>
							<Select
								value={newLocationId}
								onValueChange={(v) => {
									if (v === "pi-global" || v === "agents-global" || v === "project-pi" || v === "project-agents") {
										onChangeNewLocation(v);
									}
								}}
							>
								<SelectTrigger className="h-9 text-xs">
									<SelectValue placeholder={t("config.chooseFolder")} />
								</SelectTrigger>
								<SelectContent>
									{data.locations.map((location) => (
										<SelectItem key={location.id} value={location.id}>
											{location.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					{/* Description */}
					<div className="space-y-1.5">
						<Label className="text-xs font-medium text-foreground">{t("config.description")}</Label>
						<Textarea
							value={newDescription}
							placeholder={t("config.skillUseWhenPlaceholder")}
							onChange={(event) => onChangeNewDescription(event.target.value)}
							className="min-h-[64px] resize-y text-xs"
						/>
					</div>

					{/* Submit */}
					<div className="flex justify-end">
						<Button
							size="sm"
							className="gap-1.5 h-8"
							onClick={onCreate}
							disabled={!canCreate || creating}
						>
							{creating ? (
								<>
									<span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
									{t("config.creatingSkill")}
								</>
							) : (
								<>
									<Plus size={14} />
									{t("config.addSkill")}
								</>
							)}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

// ── Empty State ──────────────────────────────────────────────────────

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
	return (
		<div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
			<div className="flex size-20 items-center justify-center rounded-2xl bg-accent/5 border border-accent/10">
				<Sparkles size={32} className="text-accent" />
			</div>
			<div className="space-y-1.5">
				<h3 className="text-base font-semibold text-foreground">{t("config.emptySkills")}</h3>
				<p className="text-xs text-muted-foreground max-w-xs">
					{t("skills.pageDescription")}
				</p>
			</div>
			<Button size="sm" className="gap-1.5" onClick={onCreateClick}>
				<Plus size={14} />
				{t("config.addSkill")}
			</Button>
		</div>
	);
}

// ── Main Skills Tab ──────────────────────────────────────────────────

export function SkillsTab(props: {
	data: PiSkillListResult;
	loading: boolean;
	creating: boolean;
	newName: string;
	newDescription: string;
	newLocationId: PiSkillLocation["id"];
	onRefresh: () => void;
	onOpenRoot: () => void;
	onChangeNewName: (value: string) => void;
	onChangeNewDescription: (value: string) => void;
	onChangeNewLocation: (value: PiSkillLocation["id"]) => void;
	onCreate: () => void;
	onToggle: (skill: PiSkillSummary, enabled: boolean) => void;
	onDelete: (skill: PiSkillSummary) => void;
	onEdit: (skill: PiSkillSummary) => void;
	onRename: (skill: PiSkillSummary, newName: string) => Promise<void>;
}) {
	const { data } = props;
	const [skillTab, setSkillTab] = useState<"local" | "store">("local");
	const [storeSource, setStoreSource] = useState<"promptchat" | "skillhub">("skillhub");
	const [searchQuery, setSearchQuery] = useState("");
	// 新建表单展开状态提到这里：空状态的「创建 Skill」按钮也靠它展开表单
	const [createFormExpanded, setCreateFormExpanded] = useState(false);

	// 按搜索过滤技能
	const filteredSkills = useMemo(() => {
		if (!searchQuery.trim()) return data.skills;
		const q = searchQuery.toLowerCase();
		return data.skills.filter(
			(s) =>
				s.name.toLowerCase().includes(q) ||
				s.description.toLowerCase().includes(q) ||
				s.path.toLowerCase().includes(q)
		);
	}, [data.skills, searchQuery]);

	// 分离 enabled / disabled
	const enabledSkills = filteredSkills.filter((s) => s.enabled);
	const disabledSkills = filteredSkills.filter((s) => !s.enabled);

	return (
		<div className="skills-tab-v2">
			{/* 一级 tab：本地 / 商店 */}
			<div className="skills-tab-header mb-4">
				<div className="flex items-center justify-between">
					<Tabs
						value={skillTab}
						onValueChange={(v) => { if (v === "local" || v === "store") setSkillTab(v); }}
						className=""
					>
						<TabsList className="h-9 rounded-lg">
							<TabsTrigger
								value="local"
								onClick={() => props.onRefresh()}
								className="rounded-md px-3 py-1.5 text-xs data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
							>
								{t("config.nav.skills")}
							</TabsTrigger>
							<TabsTrigger
								value="store"
								className="rounded-md px-3 py-1.5 text-xs data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
							>
								<ShoppingBag size={13} strokeWidth={1.8} className="mr-1" />
								{t("config.promptStoreTab")}
							</TabsTrigger>
						</TabsList>
					</Tabs>

					{/* Store 二级 tab */}
					{skillTab === "store" && (
						<Tabs
							value={storeSource}
							onValueChange={(v) => { if (v === "skillhub" || v === "promptchat") setStoreSource(v); }}
							className="hidden sm:block"
						>
							<TabsList className="h-7 rounded-md bg-muted/50">
								<TabsTrigger value="skillhub" className="px-2.5 py-1 text-[11px] rounded-sm">
									<Store size={12} strokeWidth={1.8} className="mr-1" />
									{t("config.tabs.skillHub")}
								</TabsTrigger>
								<TabsTrigger value="promptchat" className="px-2.5 py-1 text-[11px] rounded-sm">
									<Globe size={12} strokeWidth={1.8} className="mr-1" />
									Prompt.chat
								</TabsTrigger>
							</TabsList>
						</Tabs>
					)}
				</div>
			</div>

			{skillTab === "store" ? (
				<div className="skills-store-content">
					{storeSource === "skillhub" ? (
						<SkillHubStorePanel />
					) : (
						<SkillStoreTab
							onImported={props.onRefresh}
							locationId={props.newLocationId}
						/>
					)}
				</div>
			) : (
				<>
					{/* 工具栏 */}
					<div className="skills-toolbar mb-4 flex flex-wrap items-center justify-between gap-3">
						{/* 左侧：计数 + 提示 */}
						<div className="flex flex-col gap-0.5">
							<div className="flex items-center gap-2">
								<span className="font-mono text-xs tabular-nums text-muted-foreground">
									{t("config.count.skills", { count: data.skills.length })}
								</span>
								<span className="text-[10px] text-muted-foreground/70 hidden sm:inline">
									· {t("config.restartHint")}
								</span>
							</div>
						</div>

						{/* 右侧：操作按钮 */}
						<div className="flex items-center gap-2">
							{/* 搜索框 */}
							<div className="relative">
								<Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
								<Input
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									placeholder={t("app.skillPickerSearchPlaceholder")}
									className="h-8 w-48 bg-card pl-8 text-xs"
								/>
								{searchQuery && (
									<Button
										variant="ghost"
										size="icon-xs"
										className="absolute right-1 top-1/2 -translate-y-1/2 size-5"
										onClick={() => setSearchQuery("")}
									>
										<X size={10} />
									</Button>
								)}
							</div>

							<Button
								variant="outline"
								size="sm"
								className="h-8 gap-1 text-xs"
								onClick={props.onRefresh}
								disabled={props.loading}
							>
								{t("common.refresh")}
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="h-8 gap-1 text-xs"
								onClick={props.onOpenRoot}
							>
								<ExternalLink size={12} />
								{t("config.openFolder")}
							</Button>
						</div>
					</div>

					{/* 新建表单 */}
					<CreateSkillForm
						creating={props.creating}
						newName={props.newName}
						newDescription={props.newDescription}
						newLocationId={props.newLocationId}
						data={data}
						expanded={createFormExpanded}
						onToggleExpanded={() => setCreateFormExpanded((value) => !value)}
						onChangeNewName={props.onChangeNewName}
						onChangeNewDescription={props.onChangeNewDescription}
						onChangeNewLocation={props.onChangeNewLocation}
						onCreate={props.onCreate}
					/>

					{/* 技能卡片网格 */}
					{filteredSkills.length === 0 ? (
						searchQuery ? (
							<div className="flex flex-col items-center gap-2 py-12 text-center">
								<Search size={24} className="text-muted-foreground/40" />
								<p className="text-sm text-muted-foreground">
									{t("config.noSearchResults")}
								</p>
							</div>
						) : (
							<EmptyState onCreateClick={() => setCreateFormExpanded(true)} />
						)
					) : (
						<div className="skill-card-grid">
							{/* Enabled skills */}
							{enabledSkills.length > 0 && (
								<>
									{enabledSkills.length > 1 && (
										<h4 className="skill-section-label mb-2 text-xs font-medium text-muted-foreground">
											{t("common.enabled")} · {enabledSkills.length}
										</h4>
									)}
									{enabledSkills.map((skill) => (
										<SkillCard
											key={skill.id}
											skill={skill}
											onToggle={props.onToggle}
											onDelete={props.onDelete}
											onEdit={props.onEdit}
											onRename={props.onRename}
										/>
									))}
								</>
							)}

							{/* Disabled skills */}
							{disabledSkills.length > 0 && (
								<>
									{enabledSkills.length > 0 && (
										<div className="col-span-full" />
									)}
									{disabledSkills.length > 1 && (
										<h4 className="skill-section-label mb-2 mt-4 text-xs font-medium text-muted-foreground">
											{t("common.disabled")} · {disabledSkills.length}
										</h4>
									)}
									{disabledSkills.map((skill) => (
										<SkillCard
											key={skill.id}
											skill={skill}
											onToggle={props.onToggle}
											onDelete={props.onDelete}
											onEdit={props.onEdit}
											onRename={props.onRename}
										/>
									))}
								</>
							)}
						</div>
					)}
				</>
			)}
		</div>
	);
}

export type { CreatePiSkillInput };