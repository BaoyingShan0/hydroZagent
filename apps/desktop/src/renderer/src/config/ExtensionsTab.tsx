import { Button } from "../components/ui-shadcn/button";
import { Input } from "../components/ui-shadcn/input";
import { useEffect, useState, useMemo } from "react";
import {
	Copy,
	Download,
	Power,
	RotateCcw,
	Trash2,
	Search,
	ShieldCheck,
	ExternalLink,
	Plus,
	ChevronDown,
	RefreshCw,
} from "lucide-react";
import type { PiCliUpdateResult, PiExtensionListResult, PiExtensionSummary, PiPackageInfo } from "../../../shared/types";
import { t } from "../i18n";
import type { TranslationKey } from "../i18n/rendererCopy.zh-CN";
import { showNotice } from "../utils/notice";
import { writeClipboard } from "../utils/clipboard";
import { cn } from "../lib/utils";

type ExtensionsApi = {
	list: () => Promise<PiExtensionListResult>;
	uninstall: (source: string, scope?: "user" | "project" | "unknown") => Promise<void>;
	install: (source: string) => Promise<string>;
	toggle: (source: string, enabled: boolean, scope?: "user" | "project" | "unknown") => Promise<void>;
	setWhitelistDisabled: (enabled: boolean) => Promise<void>;
	removeBuiltIn: (source: string) => Promise<void>;
	restoreBuiltIn: (source: string) => Promise<void>;
	update: () => Promise<PiCliUpdateResult>;
	updateOne: (source: string) => Promise<PiCliUpdateResult>;
};

function getExtensionsApi(): ExtensionsApi {
	const api = (window as unknown as { piDesktop?: { extensions?: ExtensionsApi } })
		.piDesktop?.extensions;
	if (!api) throw new Error("PiDeck extensions API is not available");
	return api;
}

function formatExtensionError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const PIDEK_BUILTIN_SOURCE: Record<string, string> = {
	"pi-deck-todo": "pi-deck-todo.ts",
	"pi-deck-plan-mode": "pi-deck-plan-mode.ts",
	"pi-deck-goal-mode": "pi-deck-goal-mode.ts",
	"pi-deck-ask-question": "pi-deck-ask-question.ts",
	"pi-deck-nul-redirect-fix": "pi-deck-nul-redirect-fix.ts",
};

type RecommendedPackage = Omit<PiPackageInfo, "description"> & { descriptionKey: TranslationKey };
const RECOMMENDED_PACKAGES: RecommendedPackage[] = [
	{
		name: "pi-deck-todo",
		descriptionKey: "config.extRecommended.piDeckTodo",
		installCmd: "npm:@earendil-works/pi-deck-todo",
		tags: ["extension"],
		downloads: "",
		updated: "",
		npmUrl: "",
		repoUrl: "https://github.com/ayuayue/PiDeck",
	},
	{
		name: "pi-deck-plan-mode",
		descriptionKey: "config.extRecommended.piDeckPlanMode",
		installCmd: "npm:@earendil-works/pi-deck-plan-mode",
		tags: ["extension"],
		downloads: "",
		updated: "",
		npmUrl: "",
		repoUrl: "https://github.com/ayuayue/PiDeck",
	},
	{
		name: "pi-deck-goal-mode",
		descriptionKey: "config.extRecommended.piDeckGoalMode",
		installCmd: "npm:@earendil-works/pi-deck-goal-mode",
		tags: ["extension"],
		downloads: "",
		updated: "",
		npmUrl: "",
		repoUrl: "https://github.com/ayuayue/PiDeck",
	},
	{
		name: "pi-deck-ask-question",
		descriptionKey: "config.extRecommended.piDeckAskQuestion",
		installCmd: "npm:@earendil-works/pi-deck-ask-question",
		tags: ["extension"],
		downloads: "",
		updated: "",
		npmUrl: "",
		repoUrl: "https://github.com/ayuayue/PiDeck",
	},
	{
		name: "pi-deck-nul-redirect-fix",
		descriptionKey: "config.extRecommended.piDeckNulRedirectFix",
		installCmd: "npm:@earendil-works/pi-deck-nul-redirect-fix",
		tags: ["extension"],
		downloads: "",
		updated: "",
		npmUrl: "",
		repoUrl: "https://github.com/ayuayue/PiDeck",
	},
	{
		name: "context-mode",
		descriptionKey: "config.extRecommended.contextMode",
		installCmd: "npm:context-mode",
		tags: ["extension"],
		downloads: "107K/mo",
		updated: "",
		npmUrl: "https://www.npmjs.com/package/context-mode",
		repoUrl: "https://github.com/mksglu/context-mode",
	},
	{
		name: "pi-web-access",
		descriptionKey: "config.extRecommended.piWebAccess",
		installCmd: "npm:pi-web-access",
		tags: ["extension"],
		downloads: "99K/mo",
		updated: "",
		npmUrl: "https://www.npmjs.com/package/pi-web-access",
		repoUrl: "https://github.com/nicobailon/pi-web-access",
	},
	{
		name: "pi-mcp-adapter",
		descriptionKey: "config.extRecommended.piMcpAdapter",
		installCmd: "npm:pi-mcp-adapter",
		tags: ["extension"],
		downloads: "99K/mo",
		updated: "",
		npmUrl: "https://www.npmjs.com/package/pi-mcp-adapter",
		repoUrl: "https://github.com/nicobailon/pi-mcp-adapter",
	},
	{
		name: "pi-subagents",
		descriptionKey: "config.extRecommended.piSubagents",
		installCmd: "npm:pi-subagents",
		tags: ["extension"],
		downloads: "92K/mo",
		updated: "",
		npmUrl: "https://www.npmjs.com/package/pi-subagents",
		repoUrl: "https://github.com/nicobailon/pi-subagents",
	},
];

function shortName(source: string): string {
	return source
		.replace(/^(?:npm|file|github|git|https?):/i, "")
		.replace(/\.ts$/, "")
		.replace(/@[^/]+\//, "");
}

// ── Recommended Package Card ─────────────────────────────────────────

function RecommendedPackageCard({
	pkg,
	alreadyInstalled,
	installing,
	onInstall,
}: {
	pkg: RecommendedPackage;
	alreadyInstalled: boolean;
	installing: boolean;
	onInstall: () => void;
}) {
	return (
		<div className={cn(
			"pkg-card group relative rounded-xl border border-border-subtle bg-card transition-all duration-300 ease-in-out overflow-hidden",
			"max-h-[48px] hover:max-h-[480px] p-3 hover:p-4 cursor-pointer hover:border-border hover:shadow-md"
		)}>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 mb-1">
						<ShieldCheck size={14} className="shrink-0 text-accent" />
						<strong className="truncate text-sm font-medium text-foreground">{pkg.name}</strong>
						{alreadyInstalled && (
							<span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
								{t("config.installed")}
							</span>
						)}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Button
						variant="ghost"
						size="icon-xs"
						className="size-7 hover:bg-accent/10 hover:text-accent transition-colors"
						title={installing ? t("config.installing") : alreadyInstalled ? t("config.installed") : t("config.install")}
						onClick={(e) => {
							e.stopPropagation();
							onInstall();
						}}
						disabled={alreadyInstalled || installing}
						aria-busy={installing}
					>
						{installing ? (
							<span className="skillhub-installing-dot" aria-hidden="true" />
						) : (
							<Download size={14} strokeWidth={1.8} />
						)}
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						className="size-7 hover:bg-muted text-muted-foreground"
						title={t("common.copy")}
						onClick={(e) => {
							e.stopPropagation();
							const cmd = `pi install ${pkg.installCmd}`;
							writeClipboard(cmd);
							showNotice(t("app.codeCopied"), 1200);
						}}
					>
						<Copy size={12} strokeWidth={1.8} />
					</Button>
				</div>
			</div>

			{/* Expandable content — hover 时显示 */}
			<div className="pkg-card-expandable mt-0 overflow-hidden">
				<p className="mt-2 text-xs leading-relaxed text-muted-foreground">
					{t(pkg.descriptionKey)}
				</p>
				<div className="mt-2 flex items-center gap-2 text-[11px] font-mono text-muted-foreground/70">
					<span className="truncate">{pkg.installCmd}</span>
				</div>
				{pkg.repoUrl && (
					<Button
						variant="ghost"
						size="icon-xs"
						className="mt-2 size-6 text-muted-foreground hover:text-foreground"
						onClick={(e) => {
							e.stopPropagation();
							window.piDesktop.app.openExternal(pkg.repoUrl!, true);
						}}
						title={t("config.openPackageDetail")}
					>
						<ExternalLink size={12} strokeWidth={1.8} />
					</Button>
				)}
			</div>
		</div>
	);
}

// ── Installed Extension Card ─────────────────────────────────────────

function ExtensionCard({
	extension,
	uninstalling,
	removingBuiltIn,
	restoringBuiltIn,
	toggling,
	updatingOne,
	onUninstall,
	onRemoveBuiltIn,
	onRestoreBuiltIn,
	onToggle,
	onUpdateOne,
	onCopyUpdateCommand,
}: {
	extension: PiExtensionSummary;
	uninstalling: boolean;
	removingBuiltIn?: boolean;
	restoringBuiltIn?: boolean;
	toggling?: boolean;
	updatingOne?: boolean;
	onUninstall: (extension: PiExtensionSummary) => void;
	onRemoveBuiltIn: (extension: PiExtensionSummary) => void;
	onRestoreBuiltIn: (extension: PiExtensionSummary) => void;
	onToggle: (extension: PiExtensionSummary) => void;
	onUpdateOne: (extension: PiExtensionSummary) => void;
	onCopyUpdateCommand: (extension: PiExtensionSummary) => void;
}) {
	const disabled = extension.enabled === false;
	const name = shortName(extension.source);

	return (
		<div
			className={cn(
				"ext-card group relative rounded-xl border border-border-subtle bg-card transition-all duration-300 ease-in-out overflow-hidden",
				disabled ? "opacity-70" : "shadow-sm",
				extension.builtIn ? "border-dashed" : "hover:border-border hover:shadow-md",
				// 折叠态
				"max-h-[56px] hover:max-h-[480px] p-3 hover:p-4 cursor-pointer"
			)}
		>
			{/* Header: name + status + toggle — 始终可见 */}
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<ShieldCheck size={14} className={cn("shrink-0", extension.builtIn ? "text-muted-foreground/60" : "text-accent")} />
						<strong
							className={cn(
								"truncate text-sm font-medium text-foreground",
								disabled ? "opacity-50" : ""
							)}
						>
							{name}
						</strong>
						{extension.builtIn && (
							<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
								{t("common.builtIn")}
							</span>
						)}
						{extension.filtered && (
							<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
								{t("config.extensionFiltered")}
							</span>
						)}
						{disabled && !extension.builtIn && (
							<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
								{t("config.extensionDisabledBadge")}
							</span>
						)}
					</div>
				</div>
				{/* Status badge + toggle — 所有扩展都有 toggle 按钮 */}
				<div className="flex shrink-0 items-center gap-1.5">
					<span className={cn(
						"px-2 py-0.5 rounded-full text-[11px] font-medium",
						extension.enabled ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"
					)}>
						{extension.enabled ? t("common.enabled") : t("common.disabled")}
					</span>
					<Button
						variant="ghost"
						size="icon-xs"
						className={cn(
							"size-6 transition-colors",
							extension.enabled
								? "hover:bg-accent/10 text-accent"
								: "hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
						)}
						onClick={(e) => {
							e.stopPropagation();
							onToggle(extension);
						}}
						title={
							toggling
								? t("config.extensionToggling")
								: disabled
									? t("config.extensionEnable")
									: t("config.extensionDisable")
						}
						disabled={toggling || uninstalling}
						aria-busy={toggling}
					>
						<Power size={14} strokeWidth={1.8} />
					</Button>
				</div>
			</div>

			{/* Expandable content — hover 时显示 */}
			<div className="ext-card-expandable mt-0 overflow-hidden">
				{/* Source path */}
				<div className="mt-2 flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground/70">
					<span className="truncate">{extension.source}</span>
				</div>

				{/* Version info */}
				{!extension.builtIn && (
					<div className="mt-2 space-y-1">
						<div className="flex items-center gap-2 text-[11px] text-muted-foreground">
							<span>v{extension.currentVersion || "-"}</span>
							<ExternalLink size={10} />
							<span>v{extension.latestVersion || "-"}</span>
							{extension.hasUpdate && (
								<span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
									{t("config.extensionUpdateAvailable")}
								</span>
							)}
						</div>
						{extension.hasUpdate && (
							<div className="flex items-center gap-2 mt-1.5">
								<Button
									size="xs"
									variant="outline"
									className="h-6 text-[11px]"
									onClick={(e) => {
										e.stopPropagation();
										onUpdateOne(extension);
									}}
									disabled={updatingOne}
									aria-busy={updatingOne}
								>
									{updatingOne ? (
										<>
											<span className="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
											{t("config.extensionUpdatingOne")}
										</>
									) : (
										<>
											<RefreshCw size={12} className="mr-1" />
											{t("config.extensionUpdateOne")}
										</>
									)}
								</Button>
								<Button
									size="xs"
									variant="ghost"
									className="h-6 text-[11px] px-2"
									onClick={(e) => {
										e.stopPropagation();
										onCopyUpdateCommand(extension);
									}}
								>
									<Copy size={11} strokeWidth={1.8} className="mr-1" />
									{t("config.extensionCopyUpdateCommand")}
								</Button>
							</div>
						)}
						{extension.updateError && (
							<div className="text-[11px] text-destructive mt-1">{extension.updateError}</div>
						)}
					</div>
				)}

				{/* Actions bar */}
				<div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
					<span className="text-[10px] text-muted-foreground truncate max-w-[60%] font-mono" title={extension.path}>
						{extension.path || "-"}
					</span>
					<div className="flex shrink-0 items-center gap-0.5">
						{/* Built-in: remove */}
						{extension.builtIn && extension.enabled !== false && (
							<Button
								variant="ghost"
								size="icon-xs"
								className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
								onClick={(e) => {
									e.stopPropagation();
									onRemoveBuiltIn(extension);
								}}
								title={removingBuiltIn ? t("config.uninstalling") : t("config.uninstall")}
								disabled={removingBuiltIn}
							>
								<Trash2 size={12} strokeWidth={1.8} />
							</Button>
						)}
						{/* Built-in: restore */}
						{extension.builtIn && extension.enabled === false && (
							<Button
								variant="ghost"
								size="icon-xs"
								className="size-7 hover:bg-accent/10 hover:text-accent"
								onClick={(e) => {
									e.stopPropagation();
									onRestoreBuiltIn(extension);
								}}
								title={t("config.restoreBuiltIn")}
								disabled={restoringBuiltIn}
							>
								<RotateCcw size={12} strokeWidth={1.8} />
							</Button>
						)}
						{/* Third-party: uninstall */}
						{!extension.builtIn && (
							<Button
								variant="ghost"
								size="icon-xs"
								className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
								onClick={(e) => {
									e.stopPropagation();
									onUninstall(extension);
								}}
								title={uninstalling ? t("config.uninstalling") : t("config.uninstall")}
								disabled={uninstalling}
							>
								<Trash2 size={12} strokeWidth={1.8} />
							</Button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

// ── Create/Install Form (for recommended section) ───────────────────

function RecommendedSection({
	extensions,
	installingSources,
	onInstall,
}: {
	extensions: PiExtensionSummary[];
	installingSources: Set<string>;
	onInstall: (pkg: Pick<PiPackageInfo, "name" | "installCmd">) => void;
}) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div className="pkg-section mb-6">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border-subtle bg-card/50 px-4 py-3 text-left text-sm text-muted-foreground hover:border-accent/50 hover:text-accent transition-all duration-200"
			>
				{expanded ? <ChevronDown size={16} /> : <Plus size={16} />}
				<span className="font-medium">{t("config.recommendedPackages")}</span>
			</button>

			<div className={cn(
				"pkg-list overflow-hidden transition-all duration-300 ease-in-out",
				expanded ? "max-h-[800px] opacity-100 mt-3" : "max-h-0 opacity-0"
			)}>
				<div className="rounded-xl border border-border-subtle bg-card p-4 space-y-3">
					<div className="pkg-grid">
						{RECOMMENDED_PACKAGES.map((pkg) => {
							const builtInSource = pkg.name.startsWith("pi-deck-") ? PIDEK_BUILTIN_SOURCE[pkg.name] : undefined;
							const builtInExt = builtInSource
								? extensions.find((ext) => ext.builtIn && ext.source === builtInSource)
								: undefined;
							const alreadyInstalled = builtInExt
								? builtInExt.enabled !== false
								: extensions.some((ext) => ext.source === pkg.installCmd);
							const installing = installingSources.has(pkg.installCmd);

							return (
								<RecommendedPackageCard
									key={pkg.name}
									pkg={pkg}
									alreadyInstalled={alreadyInstalled}
									installing={installing}
									onInstall={() => onInstall(pkg)}
								/>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}

// ── Main Extensions Tab ──────────────────────────────────────────────

export function ExtensionsTab(props: {
	data: PiExtensionListResult;
	loading: boolean;
	uninstallingSource: string | null;
	onRefresh: () => void;
	onUninstall: (extension: PiExtensionSummary) => void;
}) {
	const [installingSources, setInstallingSources] = useState<Set<string>>(() => new Set());
	const [restoringBuiltIn, setRestoringBuiltIn] = useState<string | null>(null);
	const [removingBuiltIn, setRemovingBuiltIn] = useState<string | null>(null);
	const [togglingSource, setTogglingSource] = useState<string | null>(null);
	const [whitelistDisabled, setWhitelistDisabled] = useState(false);
	const [togglingWhitelist, setTogglingWhitelist] = useState(false);
	const [updating, setUpdating] = useState<string | null>(null);
	const [updateResult, setUpdateResult] = useState<PiCliUpdateResult | null>(null);
	const [showUpdateDialog, setShowUpdateDialog] = useState(false);
	const [updatingOne, setUpdatingOne] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState("");

	// 首次挂载读取白名单总开关状态
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const settings = await window.piDesktop.settings.get();
				if (!cancelled) setWhitelistDisabled(Boolean(settings.disableExtensionWhitelist));
			} catch {
				// 读取失败时保持默认值
			}
		})();
		return () => { cancelled = true; };
	}, []);

	// 首次加载或列表刷新时展示扩展冲突通知
	useEffect(() => {
		if (!props.data.conflicts || props.data.conflicts.length === 0) return;
		for (const c of props.data.conflicts) {
			showNotice(
				t("config.extensionConflict", {
					builtIn: shortName(c.builtIn),
					thirdParty: shortName(c.thirdParty),
				}),
				8000,
				"warning",
			);
		}
	}, [props.data.conflicts]);

	const handleRemoveBuiltIn = async (extension: PiExtensionSummary) => {
		if (removingBuiltIn) return;
		setRemovingBuiltIn(extension.source);
		try {
			await getExtensionsApi().removeBuiltIn(extension.source);
			props.onRefresh();
		} catch (e) {
			showNotice(
				t("config.extensionOperationFailed", { error: formatExtensionError(e) }),
				4500,
				"error",
			);
		} finally {
			setRemovingBuiltIn(null);
		}
	};

	const handleRestoreBuiltIn = async (extension: PiExtensionSummary) => {
		if (restoringBuiltIn) return;
		setRestoringBuiltIn(extension.source);
		try {
			await getExtensionsApi().restoreBuiltIn(extension.source);
			props.onRefresh();
		} catch (e) {
			showNotice(
				t("config.extensionOperationFailed", { error: formatExtensionError(e) }),
				4500,
				"error",
			);
		} finally {
			setRestoringBuiltIn(null);
		}
	};

	const handleToggle = async (extension: PiExtensionSummary) => {
		if (togglingSource) return;
		setTogglingSource(extension.source);
		try {
			await getExtensionsApi().toggle(extension.source, extension.enabled === false, extension.scope);
			props.onRefresh();
			showNotice(
				t(
					extension.enabled === false
						? "config.extensionEnabledToast"
						: "config.extensionDisabledToast",
					{ name: shortName(extension.source) },
				),
				3500,
			);
		} catch (e) {
			showNotice(
				t("config.extensionOperationFailed", { error: formatExtensionError(e) }),
				4500,
				"error",
			);
		} finally {
			setTogglingSource(null);
		}
	};

	const handleToggleWhitelist = async () => {
		if (togglingWhitelist) return;
		setTogglingWhitelist(true);
		const next = !whitelistDisabled;
		try {
			await getExtensionsApi().setWhitelistDisabled(next);
			setWhitelistDisabled(next);
			showNotice(t(next ? "config.extensionWhitelistOnToast" : "config.extensionWhitelistOffToast"), 3500);
		} catch (e) {
			showNotice(
				t("config.extensionWhitelistToggleFailed", { error: formatExtensionError(e) }),
				4500,
				"error",
			);
		} finally {
			setTogglingWhitelist(false);
		}
	};

	const handleInstall = async (pkg: Pick<PiPackageInfo, "name" | "installCmd">) => {
		setInstallingSources((current) => new Set(current).add(pkg.installCmd));
		try {
			const builtInSource = pkg.name.startsWith("pi-deck-") ? PIDEK_BUILTIN_SOURCE[pkg.name] : undefined;
			if (builtInSource) {
				await getExtensionsApi().restoreBuiltIn(builtInSource);
			} else {
				await getExtensionsApi().install(pkg.installCmd);
			}
			props.onRefresh();
		} catch (e) {
			showNotice(
				t("config.extensionOperationFailed", { error: formatExtensionError(e) }),
				4500,
				"error",
			);
		} finally {
			setInstallingSources((current) => {
				const next = new Set(current);
				next.delete(pkg.installCmd);
				return next;
			});
		}
	};

	const handleUpdateExtensions = async () => {
		setUpdating("all");
		setUpdateResult(null);
		setShowUpdateDialog(true);
		try {
			const result = await getExtensionsApi().update();
			setUpdateResult(result);
		} catch (e) {
			showNotice(
				t("config.extensionOperationFailed", { error: formatExtensionError(e) }),
				4500,
				"error",
			);
		} finally {
			setUpdating(null);
		}
	};

	const handleUpdateOne = async (extension: PiExtensionSummary) => {
		if (updatingOne) return;
		setUpdatingOne(extension.source);
		try {
			await getExtensionsApi().updateOne(extension.source);
			props.onRefresh();
			showNotice(t("config.extensionUpdatedToast", { name: shortName(extension.source) }), 3000);
		} catch (e) {
			showNotice(
				t("config.extensionOperationFailed", { error: formatExtensionError(e) }),
				4500,
				"error",
			);
		} finally {
			setUpdatingOne(null);
		}
	};

	const handleCopyUpdateCommand = (extension: PiExtensionSummary) => {
		const command = `pi update ${extension.source}`;
		void writeClipboard(command);
		showNotice(t("config.extensionUpdateCommandCopied", { command }), 2500);
	};

	// 按搜索过滤扩展
	const filteredExtensions = useMemo(() => {
		if (!searchQuery.trim()) return props.data.extensions;
		const q = searchQuery.toLowerCase();
		return props.data.extensions.filter(
			(e) =>
				e.source.toLowerCase().includes(q) ||
				shortName(e.source).toLowerCase().includes(q) ||
				(e.path && e.path.toLowerCase().includes(q))
		);
	}, [props.data.extensions, searchQuery]);

	// 分离内置/第三方、启用/禁用
	const thirdPartyEnabled = filteredExtensions.filter((e) => !e.builtIn && e.enabled !== false);
	const thirdPartyDisabled = filteredExtensions.filter((e) => !e.builtIn && e.enabled === false);
	const builtinEnabled = filteredExtensions.filter((e) => e.builtIn && e.enabled !== false);
	const builtinDisabled = filteredExtensions.filter((e) => e.builtIn && e.enabled === false);

	return (
		<div className="extensions-tab-v2">
			{/* 更新结果弹窗 */}
			{showUpdateDialog && (
				<div className="config-update-dialog-backdrop" role="dialog" aria-modal="true">
					<div className="config-update-dialog">
						<div className="config-update-dialog-header">
							<strong>{t("settings.updateExtensionsAll")}</strong>
							<Button variant="ghost" size="icon-sm" className="size-7"
								onClick={() => {
									setShowUpdateDialog(false);
									props.onRefresh();
								}}
								disabled={Boolean(updating)}
							>
								×
							</Button>
						</div>
						<p className="config-im-form-hint">
							{updating ? t("settings.extensionsUpdatingDesc") : t("settings.extensionsUpdateResultHint")}
						</p>
						<pre className="setting-update-output">
							{updateResult ? `${updateResult.command}\n${updateResult.output}` : t("settings.extensionsUpdating")}
						</pre>
						<div className="config-update-dialog-actions">
							<Button variant="default" size="sm" onClick={() => { setShowUpdateDialog(false); props.onRefresh(); }} disabled={Boolean(updating)}>
								{t("common.close")}
							</Button>
						</div>
					</div>
				</div>
			)}

			{/* 工具栏 */}
			<div className="ext-toolbar mb-4 flex flex-wrap items-center justify-between gap-3">
				<div className="flex flex-col gap-0.5">
					<span className="font-mono text-xs tabular-nums text-muted-foreground">
						{t("config.count.extensions", { count: props.data.extensions.length })}
					</span>
					<span className="text-[10px] text-muted-foreground/70 hidden sm:inline">
						· {t("config.extensionRestartHint")}
					</span>
				</div>

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
								<Search size={10} />
							</Button>
						)}
					</div>

					<Button
						variant={whitelistDisabled ? "default" : "outline"}
						size="sm"
						className="h-8 gap-1.5 text-xs"
						onClick={() => void handleToggleWhitelist()}
						disabled={props.loading || togglingWhitelist}
						title={t("config.extensionWhitelistHint")}
					>
						<Power size={13} strokeWidth={1.8} />
						{t(whitelistDisabled ? "config.extensionWhitelistOn" : "config.extensionWhitelistOff")}
					</Button>

					<Button
						variant="outline"
						size="sm"
						className="h-8 gap-1 text-xs"
						onClick={handleUpdateExtensions}
						disabled={props.loading || Boolean(updating)}
					>
						<RefreshCw size={13} />
						{updating ? t("settings.updating") : t("settings.updateExtensionsAll")}
					</Button>

					<Button
						variant="outline"
						size="sm"
						className="h-8 gap-1 text-xs"
						onClick={props.onRefresh}
						disabled={props.loading}
					>
						{t("common.refresh")}
					</Button>
				</div>
			</div>

			{/* 推荐扩展 */}
			<RecommendedSection
				extensions={props.data.extensions}
				installingSources={installingSources}
				onInstall={handleInstall}
			/>

			{/* 已安装扩展卡片网格 */}
			{filteredExtensions.length === 0 ? (
				searchQuery ? (
					<div className="flex flex-col items-center gap-2 py-12 text-center">
						<Search size={24} className="text-muted-foreground/40" />
						<p className="text-sm text-muted-foreground">{t("config.noSearchResults")}</p>
					</div>
				) : (
					<div className="flex flex-col items-center gap-4 py-16 text-center">
						<div className="flex size-20 items-center justify-center rounded-2xl bg-accent/5 border border-accent/10">
							<ShieldCheck size={32} className="text-accent" />
						</div>
						<div className="space-y-1.5">
							<h3 className="text-base font-semibold text-foreground">{t("config.emptyExtensions")}</h3>
							<p className="text-xs text-muted-foreground max-w-xs">
								{t("extensions.pageDescription")}
							</p>
						</div>
					</div>
				)
			) : (
				<div className="ext-card-grid">
					{/* 启用的第三方扩展 */}
					{thirdPartyEnabled.length > 0 && (
						<>
							{thirdPartyEnabled.length > 1 && (
								<h4 className="ext-section-label mb-2 text-xs font-medium text-muted-foreground">
									{t("common.enabled")} · {thirdPartyEnabled.length}
								</h4>
							)}
							{thirdPartyEnabled.map((extension) => (
								<ExtensionCard
									key={extension.id}
									extension={extension}
									uninstalling={props.uninstallingSource === extension.source}
									onUninstall={props.onUninstall}
									onRemoveBuiltIn={handleRemoveBuiltIn}
									onRestoreBuiltIn={handleRestoreBuiltIn}
									removingBuiltIn={removingBuiltIn === extension.source}
									restoringBuiltIn={restoringBuiltIn === extension.source}
									toggling={togglingSource === extension.source}
									onToggle={handleToggle}
									updatingOne={updatingOne === extension.source}
									onUpdateOne={handleUpdateOne}
									onCopyUpdateCommand={handleCopyUpdateCommand}
								/>
							))}
						</>
					)}

					{/* 禁用的第三方扩展 */}
					{thirdPartyDisabled.length > 0 && (
						<>
							{thirdPartyEnabled.length > 0 && <div className="col-span-full" />}
							{thirdPartyDisabled.length > 1 && (
								<h4 className="ext-section-label mb-2 mt-4 text-xs font-medium text-muted-foreground">
									{t("common.disabled")} · {thirdPartyDisabled.length}
								</h4>
							)}
							{thirdPartyDisabled.map((extension) => (
								<ExtensionCard
									key={extension.id}
									extension={extension}
									uninstalling={props.uninstallingSource === extension.source}
									onUninstall={props.onUninstall}
									onRemoveBuiltIn={handleRemoveBuiltIn}
									onRestoreBuiltIn={handleRestoreBuiltIn}
									removingBuiltIn={removingBuiltIn === extension.source}
									restoringBuiltIn={restoringBuiltIn === extension.source}
									toggling={togglingSource === extension.source}
									onToggle={handleToggle}
									updatingOne={updatingOne === extension.source}
									onUpdateOne={handleUpdateOne}
									onCopyUpdateCommand={handleCopyUpdateCommand}
								/>
							))}
						</>
					)}

					{/* 启用的内置扩展 */}
					{builtinEnabled.length > 0 && (
						<>
							{(thirdPartyEnabled.length > 0 || thirdPartyDisabled.length > 0) && <div className="col-span-full" />}
							{builtinEnabled.length > 1 && (
								<h4 className="ext-section-label mb-2 mt-4 text-xs font-medium text-muted-foreground">
									{t("common.builtIn")} · {builtinEnabled.length}
								</h4>
							)}
							{builtinEnabled.map((extension) => (
								<ExtensionCard
									key={extension.id}
									extension={extension}
									uninstalling={props.uninstallingSource === extension.source}
									onUninstall={props.onUninstall}
									onRemoveBuiltIn={handleRemoveBuiltIn}
									onRestoreBuiltIn={handleRestoreBuiltIn}
									removingBuiltIn={removingBuiltIn === extension.source}
									restoringBuiltIn={restoringBuiltIn === extension.source}
									toggling={togglingSource === extension.source}
									onToggle={handleToggle}
									updatingOne={updatingOne === extension.source}
									onUpdateOne={handleUpdateOne}
									onCopyUpdateCommand={handleCopyUpdateCommand}
								/>
							))}
						</>
					)}

					{/* 禁用的内置扩展 */}
					{builtinDisabled.length > 0 && (
						<>
							{(builtinEnabled.length > 0 || thirdPartyEnabled.length > 0 || thirdPartyDisabled.length > 0) && <div className="col-span-full" />}
							{builtinDisabled.length > 1 && (
								<h4 className="ext-section-label mb-2 mt-4 text-xs font-medium text-muted-foreground">
									{t("config.restoreBuiltIn")} · {builtinDisabled.length}
								</h4>
							)}
							{builtinDisabled.map((extension) => (
								<ExtensionCard
									key={extension.id}
									extension={extension}
									uninstalling={props.uninstallingSource === extension.source}
									onUninstall={props.onUninstall}
									onRemoveBuiltIn={handleRemoveBuiltIn}
									onRestoreBuiltIn={handleRestoreBuiltIn}
									removingBuiltIn={removingBuiltIn === extension.source}
									restoringBuiltIn={restoringBuiltIn === extension.source}
									toggling={togglingSource === extension.source}
									onToggle={handleToggle}
									updatingOne={updatingOne === extension.source}
									onUpdateOne={handleUpdateOne}
									onCopyUpdateCommand={handleCopyUpdateCommand}
								/>
							))}
						</>
					)}
				</div>
			)}
		</div>
	);
}