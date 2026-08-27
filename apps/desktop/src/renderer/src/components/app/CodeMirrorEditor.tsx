import { memo, useEffect, useRef, useState } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { foldGutter, foldKeymap, indentOnInput, bracketMatching, indentUnit } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from "@codemirror/commands";
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { linter, lintGutter } from "@codemirror/lint";
import { jsonParseLinter } from "@codemirror/lang-json";
import { ClipboardPaste, Copy, Paperclip, Scissors, TextSelect } from "lucide-react";
import { baseEditorExtensions, foldMarkerDOM, resolveEditorLanguage } from "../../utils/codemirrorSetup";
import { readClipboardText, writeClipboard } from "../../utils/clipboard";
import { t } from "../../i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui-shadcn/dropdown-menu";

export type CodeMirrorEditorProps = {
	value: string;
	onChange?: (value: string) => void;
	/** 文件扩展名（"ts"）或旧 Monaco 语言 id（"markdown"），解析见 resolveEditorLanguage。 */
	language?: string;
	height?: string;
	readOnly?: boolean;
	/** 鼠标选中文本后右键菜单「引用选中内容」：携带选区起止行号（1 起），由调用方插入输入框。 */
	onAttachSelection?: (startLine: number, endLine: number) => void;
};

/** 右键菜单状态：保存打开菜单时的稳定选区，避免菜单获焦后操作错位。 */
type SelectionMenu = {
	x: number;
	y: number;
	from: number;
	to: number;
	startLine: number | null;
	endLine: number | null;
};

type EditorMenuCommand = "copy" | "cut" | "paste" | "selectAll";

/** 统一封装：与旧 MonacoEditor 的 props 完全兼容（value/onChange/language/height/readOnly），
 * 外部切换时零成本替换。EditorView 生命周期由本组件托管：卸载 dispose、外部 value 变化
 * 以「与当前文档不同才替换」的方式同步，避免覆盖用户正在输入的内容。 */
export const CodeMirrorEditor = memo(function CodeMirrorEditor({
	value,
	onChange,
	language,
	height = "100%",
	readOnly = false,
	onAttachSelection,
}: CodeMirrorEditorProps) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<EditorView | null>(null);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const onAttachSelectionRef = useRef(onAttachSelection);
	onAttachSelectionRef.current = onAttachSelection;
	// 外部 value 快照：仅用于跳过「onChange 已同步过」的重复 dispatch
	const lastValueRef = useRef(value);
	const [selectionMenu, setSelectionMenu] = useState<SelectionMenu | null>(null);

	// 右键始终使用应用菜单：有选区时保留选区；在选区外右键时把光标移到点击位置，
	// 使「粘贴」落点符合桌面编辑器习惯。行号从 1 起，与 CodeMirror gutter 一致。
	const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
		const view = viewRef.current;
		if (!view) return;
		event.preventDefault();
		const main = view.state.selection.main;
		const clickedPosition = view.posAtCoords({ x: event.clientX, y: event.clientY });
		const clickedOutsideSelection = clickedPosition !== null
			&& (main.empty || clickedPosition < main.from || clickedPosition > main.to);
		const from = clickedOutsideSelection ? clickedPosition : main.from;
		const to = clickedOutsideSelection ? clickedPosition : main.to;
		if (clickedOutsideSelection) view.dispatch({ selection: { anchor: clickedPosition } });
		setSelectionMenu({
			x: event.clientX,
			y: event.clientY,
			from,
			to,
			startLine: from === to ? null : view.state.doc.lineAt(from).number,
			endLine: from === to ? null : view.state.doc.lineAt(to).number,
		});
	};

	/** 执行菜单命令。读写剪贴板统一走 Electron bridge，Web/preview 环境再降级浏览器 API。 */
	const runMenuCommand = async (command: EditorMenuCommand) => {
		const view = viewRef.current;
		const menu = selectionMenu;
		if (!view || !menu) return;
		setSelectionMenu(null);

		if (command === "selectAll") {
			view.dispatch({ selection: { anchor: 0, head: view.state.doc.length }, scrollIntoView: true });
			view.focus();
			return;
		}

		const from = Math.min(menu.from, view.state.doc.length);
		const to = Math.min(menu.to, view.state.doc.length);
		if (command === "copy") {
			if (from !== to) await writeClipboard(view.state.sliceDoc(from, to));
			view.focus();
			return;
		}

		// 只读实例永远不执行变更命令；菜单层也会隐藏剪切与粘贴。
		if (readOnly) return;
		if (command === "cut") {
			if (from === to) return;
			await writeClipboard(view.state.sliceDoc(from, to));
			view.dispatch({ changes: { from, to, insert: "" }, selection: { anchor: from } });
			view.focus();
			return;
		}

		let clipboardText = readClipboardText();
		if (!clipboardText && navigator.clipboard?.readText) {
			clipboardText = await navigator.clipboard.readText().catch(() => "");
		}
		if (clipboardText) {
			view.dispatch({
				changes: { from, to, insert: clipboardText },
				selection: { anchor: from + clipboardText.length },
			});
		}
		view.focus();
	};

	useEffect(() => {
		if (!hostRef.current) return;
		const resolvedLanguage = resolveEditorLanguage(language);
		// JSON 语言包（LanguageSupport）的 language 字段为 "json"，用于启用 lint
		const isJson = resolvedLanguage !== null && "language" in resolvedLanguage && resolvedLanguage.language.name === "json";
		const view = new EditorView({
			parent: hostRef.current,
			state: EditorState.create({
				doc: value,
				extensions: [
					...baseEditorExtensions({ readOnly, wordWrap: true, language: resolvedLanguage }),
					// 与 Monaco 默认一致的编辑体验：行号/折叠/自动换行/括号匹配/补全/查找
					lineNumbers(),
					foldGutter({ markerDOM: foldMarkerDOM }),
					history(),
					drawSelection(),
					dropCursor(),
					indentOnInput(),
					bracketMatching(),
					closeBrackets(),
					autocompletion(),
					rectangularSelection(),
					crosshairCursor(),
					highlightActiveLine(),
					highlightActiveLineGutter(),
					highlightSelectionMatches(),
					indentUnit.of("  "),
					// JSON 语法错误即时提示（配置文件编辑高价值；YAML 暂无官方 linter）
					...(isJson
						? [lintGutter(), linter(jsonParseLinter())]
						: []),
					keymap.of([
						...closeBracketsKeymap,
						...defaultKeymap,
						...searchKeymap,
						...historyKeymap,
						...foldKeymap,
						...completionKeymap,
						indentWithTab,
						// Ctrl+/ 注释/取消注释（语言包支持时）
						{ key: "Mod-/", run: toggleComment },
					]),
					EditorView.updateListener.of((update) => {
						if (update.docChanged) {
							const next = update.state.doc.toString();
							lastValueRef.current = next;
							onChangeRef.current?.(next);
						}
					}),
				],
			}),
		});
		viewRef.current = view;
		lastValueRef.current = value;
		return () => {
			view.destroy();
			viewRef.current = null;
		};
	// 语言/只读变化需重建实例（CM6 无热切换语言的标准路径，重建成本低且简单可靠）
	}, [language, readOnly]);

	// 外部 value 同步：只在文档确实不同时替换（防止覆盖用户输入、防止 onChange 回环）
	useEffect(() => {
		const view = viewRef.current;
		// onChange 的父层回声已经由 updateListener 记录，禁止再次全文替换；否则光标和选区会重置。
		if (!view || lastValueRef.current === value) return;
		if (view.state.doc.toString() === value) {
			lastValueRef.current = value;
			return;
		}
		// 真正的外部更新（切文件/重新加载）仍保留可用的光标与选区位置，而不是跳到首行。
		const main = view.state.selection.main;
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: value },
			selection: {
				anchor: Math.min(main.anchor, value.length),
				head: Math.min(main.head, value.length),
			},
		});
		lastValueRef.current = value;
	}, [value]);

	const hasSelection = Boolean(selectionMenu && selectionMenu.from !== selectionMenu.to);

	return <div ref={hostRef} style={{ height, minHeight: 60 }} className="codemirror-host" onContextMenu={handleContextMenu}>
		{/* 虚拟锚点钉在右键坐标上（与 FileContextMenu 同模式，Radix 处理视口碰撞/ESC）。 */}
		{selectionMenu && (
			<DropdownMenu open onOpenChange={(open) => { if (!open) setSelectionMenu(null); }}>
				<DropdownMenuTrigger
					aria-hidden
					tabIndex={-1}
					style={{
						position: "fixed",
						left: selectionMenu.x,
						top: selectionMenu.y,
						width: 0,
						height: 0,
						padding: 0,
						border: 0,
						background: "transparent",
						pointerEvents: "none",
					}}
				/>
				<DropdownMenuContent align="start" side="bottom" className="min-w-44">
					<DropdownMenuItem disabled={!hasSelection} onSelect={() => { void runMenuCommand("copy"); }}>
						<Copy />
						{t("common.copy")}
					</DropdownMenuItem>
					{!readOnly && (
						<>
							<DropdownMenuItem disabled={!hasSelection} onSelect={() => { void runMenuCommand("cut"); }}>
								<Scissors />
								{t("common.cut")}
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => { void runMenuCommand("paste"); }}>
								<ClipboardPaste />
								{t("common.paste")}
							</DropdownMenuItem>
						</>
					)}
					<DropdownMenuItem onSelect={() => { void runMenuCommand("selectAll"); }}>
						<TextSelect />
						{t("common.selectAll")}
					</DropdownMenuItem>
					{hasSelection && onAttachSelection && (
						<DropdownMenuSeparator />
					)}
					{hasSelection && onAttachSelection && selectionMenu.startLine !== null && selectionMenu.endLine !== null && (
					<DropdownMenuItem
						onSelect={() => {
							const menu = selectionMenu;
							setSelectionMenu(null);
							if (menu.startLine !== null && menu.endLine !== null) {
								onAttachSelectionRef.current?.(menu.startLine, menu.endLine);
							}
						}}
					>
						<Paperclip />
						{t("editor.attachSelectionRange", {
							range: selectionMenu.startLine === selectionMenu.endLine
								? String(selectionMenu.startLine)
								: `${selectionMenu.startLine}-${selectionMenu.endLine}`,
						})}
					</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		)}
	</div>;
});
