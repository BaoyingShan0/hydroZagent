/**
 * Agent loop that works with AgentMessage throughout.
 * Transforms to Message[] only at the LLM call boundary.
 */

import {
	type AssistantMessage,
	type Context,
	EventStream,
	type ToolResultMessage,
	uuidv7,
	validateToolArguments,
} from "@earendil-works/pi-ai";
import { createCallFingerprint, createResultFingerprint } from "./convergence/canonicalizer.ts";
import type { ToolErrorClass, ToolObservationKind, ToolOutcomeObservation } from "./convergence/types.ts";
import { getDefaultStreamFn } from "./stream-fn.ts";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentLoopExit,
	AgentLoopResult,
	AgentMessage,
	AgentTool,
	AgentToolCall,
	AgentToolResult,
	EffectKind,
	EffectRef,
	StreamFn,
	ToolObservationDisposition,
} from "./types.ts";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

let fallbackEffectSequence = 0;
let fallbackToolObservationSequence = 0;

function nextFallbackSequence(kind: "effect" | "observation"): number {
	const current = kind === "effect" ? fallbackEffectSequence : fallbackToolObservationSequence;
	if (current >= Number.MAX_SAFE_INTEGER) throw new RangeError(`Fallback ${kind} sequence exhausted.`);
	const next = current + 1;
	if (kind === "effect") fallbackEffectSequence = next;
	else fallbackToolObservationSequence = next;
	return next;
}

/**
 * Start an agent loop with a new prompt message.
 * The prompt is added to the context and events are emitted for it.
 */
export function agentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	streamFn: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	const stream = createAgentStream();

	void runAgentLoop(
		prompts,
		context,
		config,
		async (event) => {
			stream.push(event);
		},
		signal,
		streamFn,
	).then((messages) => {
		stream.end(messages);
	});

	return stream;
}

/**
 * Continue an agent loop from the current context without adding a new message.
 * Used for retries - context already has user message or tool results.
 *
 * **Important:** The last message in context must convert to a `user` or `toolResult` message
 * via `convertToLlm`. If it doesn't, the LLM provider will reject the request.
 * This cannot be validated here since `convertToLlm` is only called once per turn.
 */
export function agentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	streamFn: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	if (context.messages.length === 0) {
		throw new Error("Cannot continue: no messages in context");
	}

	if (context.messages[context.messages.length - 1].role === "assistant") {
		throw new Error("Cannot continue from message role: assistant");
	}

	const stream = createAgentStream();

	void runAgentLoopContinue(
		context,
		config,
		async (event) => {
			stream.push(event);
		},
		signal,
		streamFn,
	).then((messages) => {
		stream.end(messages);
	});

	return stream;
}

export async function runAgentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal: AbortSignal | undefined,
	streamFn: StreamFn,
): Promise<AgentMessage[]> {
	return (await runAgentLoopWithOutcome(prompts, context, config, emit, signal, streamFn)).messages;
}

export async function runAgentLoopWithOutcome(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal: AbortSignal | undefined,
	streamFn: StreamFn,
): Promise<AgentLoopResult> {
	const newMessages: AgentMessage[] = [...prompts];
	const currentContext: AgentContext = {
		...context,
		messages: [...context.messages, ...prompts],
	};

	await emit({ type: "agent_start" });
	await emit({ type: "turn_start" });
	for (const prompt of prompts) {
		await emit({ type: "message_start", message: prompt });
		await emit({ type: "message_end", message: prompt });
	}

	const exit = await runLoop(currentContext, newMessages, config, signal, emit, streamFn ?? getDefaultStreamFn());
	return { messages: newMessages, exit };
}

export async function runAgentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal: AbortSignal | undefined,
	streamFn: StreamFn,
): Promise<AgentMessage[]> {
	return (await runAgentLoopContinueWithOutcome(context, config, emit, signal, streamFn)).messages;
}

export async function runAgentLoopContinueWithOutcome(
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal: AbortSignal | undefined,
	streamFn: StreamFn,
): Promise<AgentLoopResult> {
	if (context.messages.length === 0) {
		throw new Error("Cannot continue: no messages in context");
	}

	if (context.messages[context.messages.length - 1].role === "assistant") {
		throw new Error("Cannot continue from message role: assistant");
	}

	const newMessages: AgentMessage[] = [];
	const currentContext: AgentContext = { ...context };

	await emit({ type: "agent_start" });
	await emit({ type: "turn_start" });

	const exit = await runLoop(currentContext, newMessages, config, signal, emit, streamFn ?? getDefaultStreamFn());
	return { messages: newMessages, exit };
}

function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
	return new EventStream<AgentEvent, AgentMessage[]>(
		(event: AgentEvent) => event.type === "agent_end",
		(event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
	);
}

/**
 * Main loop logic shared by agentLoop and agentLoopContinue.
 */
async function runLoop(
	initialContext: AgentContext,
	newMessages: AgentMessage[],
	initialConfig: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	streamFunction: StreamFn,
): Promise<AgentLoopExit> {
	let currentContext = initialContext;
	let config = initialConfig;
	let firstTurn = true;
	const taskRunId = initialConfig.taskRunId ?? initialConfig.sessionId ?? "unmanaged";
	const createEffectRef = (kind: EffectKind): EffectRef => {
		if (initialConfig.createEffectRef) return initialConfig.createEffectRef(kind);
		const sequence = nextFallbackSequence("effect");
		return {
			effectId: `${taskRunId}:${kind}:${sequence}:${uuidv7()}`,
			kind,
			taskRunId,
			sequence,
		};
	};
	const nextToolObservationSequence = (): number => {
		if (initialConfig.nextToolObservationSequence) return initialConfig.nextToolObservationSequence();
		return nextFallbackSequence("observation");
	};
	// Check for steering messages at start (user may have typed while waiting)
	let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

	// Outer loop: continues when queued follow-up messages arrive after agent would stop
	while (true) {
		let hasMoreToolCalls = true;

		// Inner loop: process tool calls and steering messages
		while (hasMoreToolCalls || pendingMessages.length > 0) {
			if (!firstTurn) {
				await emit({ type: "turn_start" });
			} else {
				firstTurn = false;
			}

			// Process pending messages (inject before next assistant response)
			if (pendingMessages.length > 0) {
				for (const message of pendingMessages) {
					await emit({ type: "message_start", message });
					await emit({ type: "message_end", message });
					currentContext.messages.push(message);
					newMessages.push(message);
				}
				pendingMessages = [];
			}

			// Stream assistant response
			const streamed = await streamAssistantResponse(
				currentContext,
				config,
				signal,
				emit,
				streamFunction,
				createEffectRef,
			);
			if (streamed.kind === "exit") {
				if (streamed.exit.kind === "paused") {
					await emit({
						type: "agent_end",
						messages: newMessages,
						outcome: "paused",
						pauseId: streamed.exit.pauseId,
					});
				} else {
					await emit({ type: "agent_end", messages: newMessages, outcome: "aborted" });
				}
				return streamed.exit;
			}
			const message = streamed.message;
			newMessages.push(message);

			if (message.stopReason === "error" || message.stopReason === "aborted") {
				await emit({ type: "turn_end", message, toolResults: [] });
				await emit({
					type: "agent_end",
					messages: newMessages,
					outcome: message.stopReason === "aborted" ? "aborted" : "failed",
				});
				return message.stopReason === "aborted"
					? { kind: "cancelled", reason: "user_abort" }
					: { kind: "completed" };
			}

			// Check for tool calls
			const toolCalls = message.content.filter((c) => c.type === "toolCall");

			const toolResults: ToolResultMessage[] = [];
			let toolBatchPauseId: string | undefined;
			let toolBatchCancelledReason: Extract<AgentLoopExit, { kind: "cancelled" }>["reason"] | undefined;
			let toolBatchReplanRequired = false;
			hasMoreToolCalls = false;
			if (toolCalls.length > 0) {
				// A "length" stop means the output was cut off by the token limit, so
				// every tool call in the message may carry truncated arguments. Fail
				// them all instead of executing potentially borked calls.
				const executedToolBatch =
					message.stopReason === "length"
						? await failToolCallsFromTruncatedMessage(toolCalls, config, emit, nextToolObservationSequence)
						: await executeToolCalls(
								currentContext,
								message,
								config,
								signal,
								emit,
								createEffectRef,
								nextToolObservationSequence,
							);
				toolResults.push(...executedToolBatch.messages);
				toolBatchPauseId = executedToolBatch.pauseId;
				toolBatchCancelledReason = executedToolBatch.cancelledReason;
				toolBatchReplanRequired = executedToolBatch.replanRequired === true;
				hasMoreToolCalls = toolBatchReplanRequired || !executedToolBatch.terminate;

				for (const result of toolResults) {
					currentContext.messages.push(result);
					newMessages.push(result);
				}
			}

			await emit({ type: "turn_end", message, toolResults });
			if (toolBatchCancelledReason) {
				await emit({ type: "agent_end", messages: newMessages, outcome: "aborted" });
				return { kind: "cancelled", reason: toolBatchCancelledReason };
			}
			if (toolBatchPauseId) {
				await emit({ type: "agent_end", messages: newMessages, outcome: "paused", pauseId: toolBatchPauseId });
				return { kind: "paused", pauseId: toolBatchPauseId };
			}

			const nextTurnContext = {
				message,
				toolResults,
				context: currentContext,
				newMessages,
			};
			const nextTurnSnapshot = await config.prepareNextTurn?.(nextTurnContext);
			if (nextTurnSnapshot) {
				currentContext = nextTurnSnapshot.context ?? currentContext;
				config = {
					...config,
					model: nextTurnSnapshot.model ?? config.model,
					reasoning:
						nextTurnSnapshot.thinkingLevel === undefined
							? config.reasoning
							: nextTurnSnapshot.thinkingLevel === "off"
								? undefined
								: nextTurnSnapshot.thinkingLevel,
				};
			}

			// A convergence replan is a mandatory provider turn. A generic stop hook
			// cannot consume it before that turn is dispatched.
			if (
				!toolBatchReplanRequired &&
				(await config.shouldStopAfterTurn?.({
					message,
					toolResults,
					context: currentContext,
					newMessages,
				}))
			) {
				await emit({ type: "agent_end", messages: newMessages, outcome: "completed" });
				return { kind: "completed" };
			}

			pendingMessages = (await config.getSteeringMessages?.()) || [];
		}

		// Agent would stop here. Check for follow-up messages.
		const followUpMessages = (await config.getFollowUpMessages?.()) || [];
		if (followUpMessages.length > 0) {
			// Set as pending so inner loop processes them
			pendingMessages = followUpMessages;
			continue;
		}

		// No more messages, exit
		break;
	}

	await emit({ type: "agent_end", messages: newMessages, outcome: "completed" });
	return { kind: "completed" };
}

type StreamAssistantResponseResult =
	| { kind: "message"; message: AssistantMessage }
	| { kind: "exit"; exit: Extract<AgentLoopExit, { kind: "paused" | "cancelled" }> };

/**
 * Stream an assistant response from the LLM.
 * This is where AgentMessage[] gets transformed to Message[] for the LLM.
 */
async function streamAssistantResponse(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	streamFunction: StreamFn,
	createEffectRef: (kind: EffectKind) => EffectRef,
): Promise<StreamAssistantResponseResult> {
	// Apply context transform if configured (AgentMessage[] → AgentMessage[])
	let messages = context.messages;
	if (config.transformContext) {
		messages = await config.transformContext(messages, signal);
	}

	// Convert to LLM-compatible messages (AgentMessage[] → Message[])
	const llmMessages = await config.convertToLlm(messages);

	// Build LLM context
	const llmContext: Context = {
		systemPrompt: context.systemPrompt,
		messages: llmMessages,
		tools: context.tools,
	};
	// Resolve expiring credentials before the final synchronous admission boundary.
	const resolvedApiKey =
		(config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;

	const effect = createEffectRef("provider_request");
	let admittedEffect: EffectRef | undefined;
	if (config.beforeRequest) {
		if (signal?.aborted) {
			return { kind: "exit", exit: { kind: "cancelled", reason: "user_abort" } };
		}
		const admission = config.beforeRequest(
			{
				effect,
				model: { provider: config.model.provider, id: config.model.id },
				taskSnapshot: config.taskSnapshot,
			},
			signal,
		);
		if (admission.kind === "paused") {
			return { kind: "exit", exit: { kind: "paused", pauseId: admission.pause.pauseId } };
		}
		if (admission.kind === "cancelled") {
			return { kind: "exit", exit: admission };
		}
		admittedEffect = admission.effect;
	}

	let effectSettled = false;
	const settleEffect = async (outcome: "completed" | "error" | "cancelled"): Promise<void> => {
		if (!admittedEffect || effectSettled) return;
		effectSettled = true;
		await emit({ type: "external_effect_end", effect: admittedEffect, outcome });
	};
	const startEmission = admittedEffect
		? Promise.resolve(emit({ type: "external_effect_start", effect: admittedEffect }))
		: Promise.resolve();
	let responsePromise: Promise<Awaited<ReturnType<StreamFn>>>;
	try {
		responsePromise = Promise.resolve(
			streamFunction(config.model, llmContext, {
				...config,
				apiKey: resolvedApiKey,
				signal,
			}),
		);
	} catch (error) {
		responsePromise = Promise.reject(error);
	}

	let response: Awaited<ReturnType<StreamFn>>;
	try {
		[, response] = await Promise.all([startEmission, responsePromise]);
	} catch (error) {
		await settleEffect(signal?.aborted ? "cancelled" : "error");
		throw error;
	}

	let partialMessage: AssistantMessage | null = null;
	let addedPartial = false;

	try {
		for await (const event of response) {
			switch (event.type) {
				case "start":
					partialMessage = event.partial;
					context.messages.push(partialMessage);
					addedPartial = true;
					await emit({ type: "message_start", message: { ...partialMessage } });
					break;

				case "text_start":
				case "text_delta":
				case "text_end":
				case "thinking_start":
				case "thinking_delta":
				case "thinking_end":
				case "toolcall_start":
				case "toolcall_delta":
				case "toolcall_end":
					if (partialMessage) {
						partialMessage = event.partial;
						context.messages[context.messages.length - 1] = partialMessage;
						await emit({
							type: "message_update",
							assistantMessageEvent: event,
							message: { ...partialMessage },
						});
					}
					break;

				case "done":
				case "error": {
					let finalMessage: AssistantMessage;
					try {
						finalMessage = await response.result();
					} catch (error) {
						await settleEffect(signal?.aborted ? "cancelled" : "error");
						throw error;
					}
					await settleEffect(
						finalMessage.stopReason === "aborted"
							? "cancelled"
							: finalMessage.stopReason === "error"
								? "error"
								: "completed",
					);
					if (addedPartial) {
						context.messages[context.messages.length - 1] = finalMessage;
					} else {
						context.messages.push(finalMessage);
					}
					if (!addedPartial) {
						await emit({ type: "message_start", message: { ...finalMessage } });
					}
					await emit({ type: "message_end", message: finalMessage });
					return { kind: "message", message: finalMessage };
				}
			}
		}
	} catch (error) {
		await settleEffect(signal?.aborted ? "cancelled" : "error");
		throw error;
	}

	let finalMessage: AssistantMessage;
	try {
		finalMessage = await response.result();
	} catch (error) {
		await settleEffect(signal?.aborted ? "cancelled" : "error");
		throw error;
	}
	await settleEffect(
		finalMessage.stopReason === "aborted" ? "cancelled" : finalMessage.stopReason === "error" ? "error" : "completed",
	);
	if (addedPartial) {
		context.messages[context.messages.length - 1] = finalMessage;
	} else {
		context.messages.push(finalMessage);
		await emit({ type: "message_start", message: { ...finalMessage } });
	}
	await emit({ type: "message_end", message: finalMessage });
	return { kind: "message", message: finalMessage };
}

/**
 * Fail all tool calls from an assistant message that was truncated by the
 * output token limit. Streamed tool-call arguments are finalized with a
 * best-effort JSON salvage parser, so a truncated message can yield tool calls
 * whose arguments parse and validate but are silently incomplete. None of them
 * are safe to execute; report each as an error so the model can re-issue them.
 */
async function failToolCallsFromTruncatedMessage(
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	emit: AgentEventSink,
	nextObservationSequence: () => number,
): Promise<ExecutedToolCallBatch> {
	const messages: ToolResultMessage[] = [];
	const control: ToolBatchControl = { replanRequired: false };
	for (const toolCall of toolCalls) {
		await emit({
			type: "tool_execution_start",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.arguments,
		});
		const finalized: FinalizedToolCallOutcome = {
			toolCall,
			result: createErrorToolResult(
				`Tool call "${toolCall.name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`,
			),
			isError: true,
			observationKind: "invalid_arguments",
			errorClass: "invalid_arguments",
			callFingerprint: tryCreateCallFingerprint(toolCall.name, toolCall.arguments),
		};
		const disposition = await observeFinalizedToolCall(finalized, config, nextObservationSequence);
		applyToolBatchDisposition(control, disposition);
		await emitToolExecutionEnd(finalized, emit);
		const toolResultMessage = createToolResultMessage(finalized);
		await emitToolResultMessage(toolResultMessage, emit);
		messages.push(toolResultMessage);
	}
	return { messages, terminate: false, ...control };
}

/**
 * Execute tool calls from an assistant message.
 */
async function executeToolCalls(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	createEffectRef: (kind: EffectKind) => EffectRef,
	nextObservationSequence: () => number,
): Promise<ExecutedToolCallBatch> {
	const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
	const hasSequentialToolCall = toolCalls.some(
		(tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",
	);
	if (config.toolExecution === "sequential" || hasSequentialToolCall) {
		return executeToolCallsSequential(
			currentContext,
			assistantMessage,
			toolCalls,
			config,
			signal,
			emit,
			createEffectRef,
			nextObservationSequence,
		);
	}
	return executeToolCallsParallel(
		currentContext,
		assistantMessage,
		toolCalls,
		config,
		signal,
		emit,
		createEffectRef,
		nextObservationSequence,
	);
}

type ExecutedToolCallBatch = {
	messages: ToolResultMessage[];
	terminate: boolean;
	replanRequired?: boolean;
	pauseId?: string;
	cancelledReason?: Extract<AgentLoopExit, { kind: "cancelled" }>["reason"];
};

type ToolBatchControl = {
	replanRequired: boolean;
	pauseId?: string;
	cancelledReason?: Extract<AgentLoopExit, { kind: "cancelled" }>["reason"];
};

type ToolBatchAdmissionState = ToolBatchControl;

function applyToolBatchDisposition(
	control: ToolBatchControl,
	disposition: ToolObservationDisposition | undefined,
): void {
	if (disposition?.kind === "cancelled") control.cancelledReason ??= disposition.reason;
	if (disposition?.kind === "paused") control.pauseId ??= disposition.pause.pauseId;
	if (disposition?.kind === "replan_required") control.replanRequired = true;
}

async function executeToolCallsSequential(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	createEffectRef: (kind: EffectKind) => EffectRef,
	nextObservationSequence: () => number,
): Promise<ExecutedToolCallBatch> {
	const finalizedCalls: FinalizedToolCallOutcome[] = [];
	const messages: ToolResultMessage[] = [];
	const control: ToolBatchControl = { replanRequired: false };
	const admissionState: ToolBatchAdmissionState = control;

	for (const toolCall of toolCalls) {
		await emit({
			type: "tool_execution_start",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.arguments,
		});

		const preparation = await prepareToolCall(
			currentContext,
			assistantMessage,
			toolCall,
			config,
			signal,
			createEffectRef,
		);
		let finalized: FinalizedToolCallOutcome;
		if (preparation.kind === "immediate") {
			finalized = finalizeImmediateToolCall(toolCall, preparation);
		} else {
			const admitted = admitPreparedToolCall(
				currentContext,
				assistantMessage,
				preparation,
				config,
				signal,
				admissionState,
			);
			if (admitted.kind === "blocked") {
				finalized = admitted.finalized;
			} else {
				const executed = await executePreparedToolCall(preparation, admitted.effect, signal, emit);
				finalized = await finalizeExecutedToolCall(
					currentContext,
					assistantMessage,
					preparation,
					executed,
					admitted.effect,
					config,
					signal,
				);
			}
		}

		const disposition = await observeFinalizedToolCall(finalized, config, nextObservationSequence);
		applyToolBatchDisposition(control, disposition);
		await emitToolExecutionEnd(finalized, emit);
		const toolResultMessage = createToolResultMessage(finalized);
		await emitToolResultMessage(toolResultMessage, emit);
		finalizedCalls.push(finalized);
		messages.push(toolResultMessage);

		if (signal?.aborted || control.cancelledReason || control.pauseId) {
			break;
		}
	}

	return {
		messages,
		terminate: shouldTerminateToolBatch(finalizedCalls),
		...control,
	};
}

async function executeToolCallsParallel(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	createEffectRef: (kind: EffectKind) => EffectRef,
	nextObservationSequence: () => number,
): Promise<ExecutedToolCallBatch> {
	const finalizedCalls: FinalizedToolCallEntry[] = [];
	const admissionState: ToolBatchAdmissionState = { replanRequired: false };

	for (const toolCall of toolCalls) {
		await emit({
			type: "tool_execution_start",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.arguments,
		});

		const preparation = await prepareToolCall(
			currentContext,
			assistantMessage,
			toolCall,
			config,
			signal,
			createEffectRef,
		);
		if (preparation.kind === "immediate") {
			const finalized = finalizeImmediateToolCall(toolCall, preparation);
			finalizedCalls.push(finalized);
			if (signal?.aborted) {
				break;
			}
			continue;
		}

		finalizedCalls.push(async () => {
			const admitted = admitPreparedToolCall(
				currentContext,
				assistantMessage,
				preparation,
				config,
				signal,
				admissionState,
			);
			if (admitted.kind === "blocked") {
				return admitted.finalized;
			}
			const executed = await executePreparedToolCall(preparation, admitted.effect, signal, emit);
			const finalized = await finalizeExecutedToolCall(
				currentContext,
				assistantMessage,
				preparation,
				executed,
				admitted.effect,
				config,
				signal,
			);
			return finalized;
		});
		if (signal?.aborted) {
			break;
		}
	}

	const orderedFinalizedCalls = await Promise.all(
		finalizedCalls.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry))),
	);
	const messages: ToolResultMessage[] = [];
	const control: ToolBatchControl = admissionState;
	for (const finalized of orderedFinalizedCalls) {
		const disposition = await observeFinalizedToolCall(finalized, config, nextObservationSequence);
		applyToolBatchDisposition(control, disposition);
		await emitToolExecutionEnd(finalized, emit);
		const toolResultMessage = createToolResultMessage(finalized);
		await emitToolResultMessage(toolResultMessage, emit);
		messages.push(toolResultMessage);
	}

	return {
		messages,
		terminate: shouldTerminateToolBatch(orderedFinalizedCalls),
		...control,
	};
}

type PreparedToolCall = {
	kind: "prepared";
	toolCall: AgentToolCall;
	tool: AgentTool<any>;
	args: unknown;
	effect: EffectRef;
	callFingerprint?: string;
};

type ImmediateToolCallOutcome = {
	kind: "immediate";
	result: AgentToolResult<any>;
	isError: boolean;
	observationKind: ToolObservationKind;
	errorClass: ToolErrorClass;
	callFingerprint?: string;
	cancelledReason?: Extract<AgentLoopExit, { kind: "cancelled" }>["reason"];
};

type ExecutedToolCallOutcome = {
	result: AgentToolResult<any>;
	isError: boolean;
};

type AdmittedToolCall = { kind: "admitted"; effect?: EffectRef };
type BlockedToolCall = { kind: "blocked"; finalized: FinalizedToolCallOutcome };

type FinalizedToolCallOutcome = {
	toolCall: AgentToolCall;
	result: AgentToolResult<any>;
	isError: boolean;
	observationKind: ToolObservationKind;
	errorClass: ToolErrorClass;
	effectId?: string;
	callFingerprint?: string;
	resultFingerprint?: string;
	pauseId?: string;
	cancelledReason?: Extract<AgentLoopExit, { kind: "cancelled" }>["reason"];
};

type FinalizedToolCallEntry = FinalizedToolCallOutcome | (() => Promise<FinalizedToolCallOutcome>);

function shouldTerminateToolBatch(finalizedCalls: FinalizedToolCallOutcome[]): boolean {
	return finalizedCalls.length > 0 && finalizedCalls.every((finalized) => finalized.result.terminate === true);
}

function tryCreateCallFingerprint(toolName: string, args: unknown): string | undefined {
	try {
		return createCallFingerprint(toolName, args);
	} catch {
		return undefined;
	}
}

/**
 * Build a JSON-compatible fingerprint projection without mutating the actual
 * tool result. Object properties whose value is undefined follow JSON object
 * semantics and are omitted recursively; array positions are preserved so an
 * undefined array element remains invalid rather than silently shifting data.
 */
function omitUndefinedObjectProperties(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
	if (value === null || typeof value !== "object") return value;
	const existing = seen.get(value);
	if (existing !== undefined) return existing;

	if (Array.isArray(value)) {
		const copy = new Array<unknown>(value.length);
		seen.set(value, copy);
		for (let index = 0; index < value.length; index += 1) {
			if (Object.hasOwn(value, index)) copy[index] = omitUndefinedObjectProperties(value[index], seen);
		}
		return copy;
	}

	const prototype = Object.getPrototypeOf(value);
	if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
		return value;
	}
	const copy = Object.create(prototype) as Record<string, unknown>;
	seen.set(value, copy);
	for (const key of Object.keys(value)) {
		const child = Reflect.get(value, key);
		if (child !== undefined) copy[key] = omitUndefinedObjectProperties(child, seen);
	}
	return copy;
}

function tryCreateResultFingerprint(finalized: FinalizedToolCallOutcome): string | undefined {
	try {
		const fingerprintProjection = omitUndefinedObjectProperties({
			content: finalized.result.content ?? [],
			details: finalized.result.details,
			usage: finalized.result.usage,
			terminate: finalized.result.terminate,
			isError: finalized.isError,
		});
		return createResultFingerprint(finalized.observationKind, finalized.errorClass, fingerprintProjection);
	} catch {
		return undefined;
	}
}

function finalizeImmediateToolCall(
	toolCall: AgentToolCall,
	immediate: ImmediateToolCallOutcome,
): FinalizedToolCallOutcome {
	const finalized: FinalizedToolCallOutcome = {
		toolCall,
		result: immediate.result,
		isError: immediate.isError,
		observationKind: immediate.observationKind,
		errorClass: immediate.errorClass,
		callFingerprint: immediate.callFingerprint,
		cancelledReason: immediate.cancelledReason,
	};
	finalized.resultFingerprint = tryCreateResultFingerprint(finalized);
	return finalized;
}

function prepareToolCallArguments(tool: AgentTool<any>, toolCall: AgentToolCall): AgentToolCall {
	if (!tool.prepareArguments) {
		return toolCall;
	}
	const preparedArguments = tool.prepareArguments(toolCall.arguments);
	if (preparedArguments === toolCall.arguments) {
		return toolCall;
	}
	return {
		...toolCall,
		arguments: preparedArguments as Record<string, any>,
	};
}

async function prepareToolCall(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCall: AgentToolCall,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	createEffectRef: (kind: EffectKind) => EffectRef,
): Promise<PreparedToolCall | ImmediateToolCallOutcome> {
	const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
	if (!tool) {
		return {
			kind: "immediate",
			result: createErrorToolResult(`Tool ${toolCall.name} not found`),
			isError: true,
			observationKind: "unknown_tool",
			errorClass: "unknown_tool",
			callFingerprint: tryCreateCallFingerprint(toolCall.name, toolCall.arguments),
		};
	}

	let validatedArgs: unknown;
	try {
		const preparedToolCall = prepareToolCallArguments(tool, toolCall);
		validatedArgs = validateToolArguments(tool, preparedToolCall);
	} catch (error) {
		return {
			kind: "immediate",
			result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
			isError: true,
			observationKind: "invalid_arguments",
			errorClass: "invalid_arguments",
			callFingerprint: tryCreateCallFingerprint(toolCall.name, toolCall.arguments),
		};
	}

	if (config.beforeToolCall) {
		try {
			const beforeResult = await config.beforeToolCall(
				{
					assistantMessage,
					toolCall,
					args: validatedArgs,
					context: currentContext,
				},
				signal,
			);
			if (signal?.aborted) {
				return {
					kind: "immediate",
					result: createErrorToolResult("Operation aborted"),
					isError: true,
					observationKind: "cancelled",
					errorClass: "cancelled",
					callFingerprint: tryCreateCallFingerprint(toolCall.name, validatedArgs),
					cancelledReason: "user_abort",
				};
			}
			if (beforeResult?.block) {
				const result = createErrorToolResult(beforeResult.reason || "Tool execution was blocked");
				if (beforeResult.terminate === true) {
					result.terminate = true;
				}
				return {
					kind: "immediate",
					result,
					isError: true,
					observationKind: "extension_block",
					errorClass: "policy_block",
					callFingerprint: tryCreateCallFingerprint(toolCall.name, validatedArgs),
				};
			}
		} catch (error) {
			return {
				kind: "immediate",
				result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
				isError: true,
				observationKind: "extension_hook_failure",
				errorClass: "extension_hook_failure",
				callFingerprint: tryCreateCallFingerprint(toolCall.name, validatedArgs),
			};
		}
	}

	if (signal?.aborted) {
		return {
			kind: "immediate",
			result: createErrorToolResult("Operation aborted"),
			isError: true,
			observationKind: "cancelled",
			errorClass: "cancelled",
			callFingerprint: tryCreateCallFingerprint(toolCall.name, validatedArgs),
			cancelledReason: "user_abort",
		};
	}

	try {
		const effectiveToolCall = {
			...toolCall,
			arguments: validatedArgs as AgentToolCall["arguments"],
		};
		validatedArgs = validateToolArguments(tool, effectiveToolCall);
	} catch (error) {
		return {
			kind: "immediate",
			result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
			isError: true,
			observationKind: "invalid_arguments_after_extension",
			errorClass: "invalid_arguments_after_extension",
			callFingerprint: tryCreateCallFingerprint(toolCall.name, validatedArgs),
		};
	}
	return {
		kind: "prepared",
		toolCall,
		tool,
		args: validatedArgs,
		effect: createEffectRef("tool"),
		callFingerprint: tryCreateCallFingerprint(toolCall.name, validatedArgs),
	};
}

function admitPreparedToolCall(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	prepared: PreparedToolCall,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	batchState: ToolBatchAdmissionState,
): AdmittedToolCall | BlockedToolCall {
	const cancelledReason = signal?.aborted ? "user_abort" : batchState.cancelledReason;
	if (cancelledReason) {
		const finalized = finalizeImmediateToolCall(prepared.toolCall, {
			kind: "immediate",
			result: createErrorToolResult("Operation aborted"),
			isError: true,
			observationKind: "cancelled",
			errorClass: "cancelled",
			callFingerprint: prepared.callFingerprint,
		});
		finalized.cancelledReason = cancelledReason;
		return {
			kind: "blocked",
			finalized,
		};
	}
	if (batchState.pauseId) {
		const finalized = finalizeImmediateToolCall(prepared.toolCall, {
			kind: "immediate",
			result: createErrorToolResult("Tool was not admitted because a sibling paused the task"),
			isError: true,
			observationKind: "sibling_not_admitted",
			errorClass: "guard_block",
			callFingerprint: prepared.callFingerprint,
		});
		finalized.pauseId = batchState.pauseId;
		return { kind: "blocked", finalized };
	}
	if (batchState.replanRequired) {
		return {
			kind: "blocked",
			finalized: finalizeImmediateToolCall(prepared.toolCall, {
				kind: "immediate",
				result: createErrorToolResult("Tool was not admitted because a sibling requires replanning"),
				isError: true,
				observationKind: "sibling_not_admitted",
				errorClass: "guard_block",
				callFingerprint: prepared.callFingerprint,
			}),
		};
	}
	if (!config.beforeToolEffect) return { kind: "admitted" };
	const admission = config.beforeToolEffect(
		{
			effect: prepared.effect,
			assistantMessage,
			toolCall: prepared.toolCall,
			args: prepared.args,
			context: currentContext,
			taskSnapshot: config.taskSnapshot,
		},
		signal,
	);
	if (admission.kind === "admitted") return { kind: "admitted", effect: admission.effect };
	if (admission.kind === "cancelled") {
		batchState.cancelledReason = admission.reason;
		const finalized = finalizeImmediateToolCall(prepared.toolCall, {
			kind: "immediate",
			result: createErrorToolResult("Operation aborted"),
			isError: true,
			observationKind: "cancelled",
			errorClass: "cancelled",
			callFingerprint: prepared.callFingerprint,
		});
		finalized.cancelledReason = admission.reason;
		return { kind: "blocked", finalized };
	}
	if (admission.kind === "replan_required") {
		const sibling = batchState.replanRequired;
		batchState.replanRequired = true;
		return {
			kind: "blocked",
			finalized: finalizeImmediateToolCall(prepared.toolCall, {
				kind: "immediate",
				result: createErrorToolResult(
					sibling
						? "Tool was not admitted because a sibling requires replanning"
						: (admission.reason ?? "Replan required"),
				),
				isError: true,
				observationKind: sibling ? "sibling_not_admitted" : "guard_replan_block",
				errorClass: "guard_block",
				callFingerprint: prepared.callFingerprint,
			}),
		};
	}
	const sibling = batchState.pauseId !== undefined;
	const finalized = finalizeImmediateToolCall(prepared.toolCall, {
		kind: "immediate",
		result: createErrorToolResult(
			sibling
				? "Tool was not admitted because a sibling paused the task"
				: "Tool execution paused by convergence guard",
		),
		isError: true,
		observationKind: sibling ? "sibling_not_admitted" : "guard_pause_block",
		errorClass: "guard_block",
		callFingerprint: prepared.callFingerprint,
	});
	batchState.pauseId ??= admission.pause.pauseId;
	finalized.pauseId = admission.pause.pauseId;
	return {
		kind: "blocked",
		finalized,
	};
}

async function executePreparedToolCall(
	prepared: PreparedToolCall,
	effect: EffectRef | undefined,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ExecutedToolCallOutcome> {
	const updateEvents: Promise<void>[] = [];
	let acceptingUpdates = true;
	const startEmission = effect ? Promise.resolve(emit({ type: "external_effect_start", effect })) : Promise.resolve();
	let startEmissionFailed = false;
	let startEmissionError: unknown;
	let execution: Promise<AgentToolResult<unknown>>;
	try {
		execution = Promise.resolve(
			prepared.tool.execute(prepared.toolCall.id, prepared.args as never, signal, (partialResult) => {
				if (!acceptingUpdates) return;
				updateEvents.push(
					Promise.resolve(
						emit({
							type: "tool_execution_update",
							toolCallId: prepared.toolCall.id,
							toolName: prepared.toolCall.name,
							args: prepared.toolCall.arguments,
							partialResult,
						}),
					),
				);
			}),
		);
	} catch (error) {
		execution = Promise.reject(error);
	}
	const executionSettlement = execution.then(
		(result) => ({ kind: "fulfilled" as const, result }),
		(error: unknown) => ({ kind: "rejected" as const, error }),
	);

	try {
		await startEmission;
	} catch (error) {
		// The tool was invoked synchronously after the start emission was created.
		// Defer propagation until the started effect has settled exactly once.
		startEmissionFailed = true;
		startEmissionError = error;
	}
	const settledExecution = await executionSettlement;
	acceptingUpdates = false;
	let updateEmissionFailed = false;
	let updateEmissionError: unknown;
	try {
		await Promise.all(updateEvents);
	} catch (error) {
		updateEmissionFailed = true;
		updateEmissionError = error;
	}
	let outcome: ExecutedToolCallOutcome;
	if (settledExecution.kind === "rejected") {
		outcome = {
			result: createErrorToolResult(
				settledExecution.error instanceof Error ? settledExecution.error.message : String(settledExecution.error),
			),
			isError: true,
		};
	} else if (updateEmissionFailed) {
		outcome = {
			result: createErrorToolResult(
				updateEmissionError instanceof Error ? updateEmissionError.message : String(updateEmissionError),
			),
			isError: true,
		};
	} else {
		outcome = { result: settledExecution.result, isError: false };
	}
	if (effect) {
		await emit({
			type: "external_effect_end",
			effect,
			outcome: outcome.isError ? (signal?.aborted ? "cancelled" : "error") : "completed",
		});
	}
	if (startEmissionFailed) throw startEmissionError;
	return outcome;
}

async function finalizeExecutedToolCall(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	prepared: PreparedToolCall,
	executed: ExecutedToolCallOutcome,
	effect: EffectRef | undefined,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
): Promise<FinalizedToolCallOutcome> {
	let result = executed.result;
	let isError = executed.isError;
	let observationKind: ToolObservationKind = "executed";
	let errorClass: ToolErrorClass = executed.isError ? "tool_execution_error" : "none";

	if (config.afterToolCall) {
		try {
			const afterResult = await config.afterToolCall(
				{
					assistantMessage,
					toolCall: prepared.toolCall,
					args: prepared.args,
					result,
					isError,
					context: currentContext,
				},
				signal,
			);
			if (afterResult) {
				result = {
					...result,
					content: afterResult.content ?? result.content,
					details: afterResult.details ?? result.details,
					usage: afterResult.usage ?? result.usage,
					terminate: afterResult.terminate ?? result.terminate,
				};
				isError = afterResult.isError ?? isError;
			}
		} catch (error) {
			result = createErrorToolResult(error instanceof Error ? error.message : String(error));
			isError = true;
			observationKind = "extension_hook_failure";
			errorClass = "extension_hook_failure";
		}
	}
	if (observationKind === "executed") errorClass = isError ? "tool_execution_error" : "none";

	const finalized: FinalizedToolCallOutcome = {
		toolCall: prepared.toolCall,
		result,
		isError,
		observationKind,
		errorClass,
		effectId: effect?.effectId,
		callFingerprint: prepared.callFingerprint,
	};
	finalized.resultFingerprint = tryCreateResultFingerprint(finalized);
	return finalized;
}

function createErrorToolResult(message: string): AgentToolResult<any> {
	return {
		content: [{ type: "text", text: message }],
		details: {},
	};
}

async function emitToolExecutionEnd(finalized: FinalizedToolCallOutcome, emit: AgentEventSink): Promise<void> {
	await emit({
		type: "tool_execution_end",
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		result: finalized.result,
		isError: finalized.isError,
	});
}

async function observeFinalizedToolCall(
	finalized: FinalizedToolCallOutcome,
	config: AgentLoopConfig,
	nextObservationSequence: () => number,
): Promise<ToolObservationDisposition | undefined> {
	if (!finalized.resultFingerprint) finalized.resultFingerprint = tryCreateResultFingerprint(finalized);
	const finalizedDisposition: ToolObservationDisposition | undefined = finalized.cancelledReason
		? { kind: "cancelled", reason: finalized.cancelledReason }
		: finalized.pauseId
			? { kind: "paused", pause: { pauseId: finalized.pauseId } }
			: undefined;
	if (!config.observeToolOutcome) return finalizedDisposition;
	const observation: ToolOutcomeObservation = {
		observationSequence: nextObservationSequence(),
		effectId: finalized.effectId,
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		kind: finalized.observationKind,
		errorClass: finalized.errorClass,
		callFingerprint: finalized.callFingerprint,
		resultFingerprint: finalized.resultFingerprint,
		isErrorForModel: finalized.isError,
		progress: "unknown",
	};
	const disposition = await config.observeToolOutcome(observation);
	return disposition ?? finalizedDisposition;
}

function createToolResultMessage(finalized: FinalizedToolCallOutcome): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		// Untyped tools (JS extensions) can return results without content; normalize
		// so the null never enters session history or provider payloads.
		content: finalized.result.content ?? [],
		details: finalized.result.details,
		usage: finalized.result.usage,
		...(finalized.result.addedToolNames?.length ? { addedToolNames: finalized.result.addedToolNames } : {}),
		isError: finalized.isError,
		timestamp: Date.now(),
	};
}

async function emitToolResultMessage(toolResultMessage: ToolResultMessage, emit: AgentEventSink): Promise<void> {
	await emit({ type: "message_start", message: toolResultMessage });
	await emit({ type: "message_end", message: toolResultMessage });
}
