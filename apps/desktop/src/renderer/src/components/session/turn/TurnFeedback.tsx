import { useCallback, useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import type { SessionTurnFeedbackInput } from "../../../../../shared/types";
import { SESSION_TURN_FEEDBACK_COMMENT_MAX_LENGTH } from "../../../../../shared/types";
import {
	sessionRecordByIdAtomFamily,
	upsertSessionAtom,
} from "../../../atoms";
import { t } from "../../../i18n";
import { Button } from "../../ui-shadcn/button";
import { Input } from "../../ui-shadcn/input";

const STAR_VALUES = [1, 2, 3, 4, 5] as const;
const COMMENT_SAVE_DELAY_MS = 650;

type SaveState = "idle" | "saving" | "saved" | "error";

export type TurnFeedbackProps = {
	sessionId: string;
	turnId: string;
	responseMessageId: string;
	durationMs: number;
};

/**
 * 回复轮次的轻量反馈闭环：星级立即保存，文字意见防抖保存并在失焦/卸载时补写。
 * 组件只订阅所属 SessionRecord，分屏中的其它会话更新不会唤醒本轮。
 */
export function TurnFeedback(props: TurnFeedbackProps) {
	const record = useAtomValue(sessionRecordByIdAtomFamily(props.sessionId));
	const upsertSession = useSetAtom(upsertSessionAtom);
	const stored = record?.turnFeedback?.find(
		(feedback) => feedback.turnId === props.turnId,
	);
	const [rating, setRating] = useState(stored?.rating ?? 0);
	const [comment, setComment] = useState(stored?.comment ?? "");
	const [hoverRating, setHoverRating] = useState<number | null>(null);
	const [saveState, setSaveState] = useState<SaveState>(
		stored ? "saved" : "idle",
	);
	const draftRef = useRef({ rating: stored?.rating ?? 0, comment: stored?.comment ?? "" });
	const pendingRef = useRef(false);
	const requestSequenceRef = useRef(0);
	const mountedRef = useRef(true);

	useEffect(() => {
		// React Strict Mode 会执行一次 setup → cleanup → setup；第二次 setup 必须恢复挂载态。
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	// Catalog 轮询或本次保存返回新记录时，仅在没有本地待保存输入时同步。
	useEffect(() => {
		if (pendingRef.current) return;
		const nextRating = stored?.rating ?? 0;
		const nextComment = stored?.comment ?? "";
		draftRef.current = { rating: nextRating, comment: nextComment };
		setRating(nextRating);
		setComment(nextComment);
		setSaveState(stored ? "saved" : "idle");
	}, [stored?.comment, stored?.rating, stored?.updatedAt]);

	const persistFeedback = useCallback(async (draft: { rating: number; comment: string }) => {
		const sequence = requestSequenceRef.current + 1;
		requestSequenceRef.current = sequence;
		if (mountedRef.current) setSaveState("saving");
		const input: SessionTurnFeedbackInput = {
			turnId: props.turnId,
			responseMessageId: props.responseMessageId,
			rating: draft.rating,
			comment: draft.comment,
			durationMs: props.durationMs,
		};
		try {
			const updated = await window.piDesktop.sessions.updateRecord(
				props.sessionId,
				{ turnFeedback: input },
			);
			if (!mountedRef.current || sequence !== requestSequenceRef.current) return;
			if (
				draftRef.current.rating === draft.rating &&
				draftRef.current.comment === draft.comment
			) {
				pendingRef.current = false;
			}
			upsertSession(updated);
			setSaveState("saved");
		} catch {
			if (!mountedRef.current || sequence !== requestSequenceRef.current) return;
			setSaveState("error");
		}
	}, [props.durationMs, props.responseMessageId, props.sessionId, props.turnId, upsertSession]);

	useEffect(() => {
		if (!pendingRef.current) return;
		const timer = window.setTimeout(() => {
			void persistFeedback(draftRef.current);
		}, COMMENT_SAVE_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, [comment, persistFeedback]);

	// 时间线窗口裁剪可能在防抖到期前卸载旧轮；离开时直接补写，避免意见丢失。
	useEffect(() => () => {
		if (!pendingRef.current) return;
		void window.piDesktop.sessions.updateRecord(props.sessionId, {
			turnFeedback: {
				turnId: props.turnId,
				responseMessageId: props.responseMessageId,
				rating: draftRef.current.rating,
				comment: draftRef.current.comment,
				durationMs: props.durationMs,
			},
		}).catch(() => undefined);
	}, [props.durationMs, props.responseMessageId, props.sessionId, props.turnId]);

	if (!record || record.noSession) return null;

	const displayedRating = hoverRating ?? rating;
	const statusLabel = saveState === "saving"
		? t("turnFeedback.saving")
		: saveState === "saved"
			? t("turnFeedback.saved")
			: saveState === "error"
				? t("turnFeedback.saveFailed")
				: "";

	return (
		<section
			className="ml-2 flex min-w-0 flex-1 items-center gap-1.5"
			data-turn-feedback={props.turnId}
			aria-label={t("turnFeedback.title")}
		>
			<span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground/80">
				{t("turnFeedback.title")}
			</span>
			<div
				className="flex shrink-0 items-center"
				role="radiogroup"
				aria-label={t("turnFeedback.ratingLabel", { rating })}
				onPointerLeave={() => setHoverRating(null)}
			>
				{STAR_VALUES.map((value) => {
					const active = value <= displayedRating;
					return (
						<Button
							key={value}
							type="button"
							variant="ghost"
							size="icon-xs"
							className={active
								? "size-5 rounded-sm p-0 text-[var(--color-warning)] hover:bg-muted hover:text-[var(--color-warning)]"
								: "size-5 rounded-sm p-0 text-muted-foreground/30 hover:bg-muted hover:text-muted-foreground/60"}
							role="radio"
							aria-checked={rating === value}
							aria-label={t("turnFeedback.starLabel", { count: value })}
							title={rating === value
								? t("turnFeedback.clearRating")
								: t("turnFeedback.starLabel", { count: value })}
							onPointerEnter={() => setHoverRating(value)}
							onFocus={() => setHoverRating(value)}
							onBlur={() => setHoverRating(null)}
							onClick={() => {
								const nextRating = rating === value ? 0 : value;
								setRating(nextRating);
								draftRef.current = { ...draftRef.current, rating: nextRating };
								pendingRef.current = true;
								void persistFeedback(draftRef.current);
							}}
						>
							<Star className={`size-3 ${active ? "fill-current" : ""}`} aria-hidden="true" />
						</Button>
					);
				})}
			</div>
			<Input
				value={comment}
				maxLength={SESSION_TURN_FEEDBACK_COMMENT_MAX_LENGTH}
				className="h-6 min-w-20 max-w-sm flex-1 border-border-subtle/70 bg-background/40 px-2 text-[11px] shadow-none placeholder:text-muted-foreground/45 focus-visible:ring-1"
				placeholder={t("turnFeedback.placeholder")}
				aria-label={t("turnFeedback.commentLabel")}
				onChange={(event) => {
					const nextComment = event.currentTarget.value;
					setComment(nextComment);
					draftRef.current = { ...draftRef.current, comment: nextComment };
					pendingRef.current = true;
					setSaveState("idle");
				}}
				onBlur={() => {
					if (pendingRef.current) void persistFeedback(draftRef.current);
				}}
			/>
			{saveState === "error" ? (
				<button
					type="button"
					className="shrink-0 text-[10px] text-destructive"
					onClick={() => void persistFeedback(draftRef.current)}
				>
					{statusLabel}
				</button>
			) : (
				<span className="sr-only" aria-live="polite">{statusLabel}</span>
			)}
		</section>
	);
}
