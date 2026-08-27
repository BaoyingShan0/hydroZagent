import type { AssistantMessage } from "@earendil-works/pi-ai/compat";

/**
 * Connection / transport / timeout failures: the network subset of retryable provider
 * errors, where the endpoint itself looks unreachable rather than merely busy.
 *
 * These are the failures worth failing over to a different model/provider for. Capacity
 * errors (overloaded, rate limit, 429/5xx) are model-specific and transient, so they stay
 * on the same-model backoff-retry path (see pi-ai `isRetryableAssistantError`) and do not
 * trigger a model switch.
 */
const CONNECTION_ERROR_PATTERN = new RegExp(
	[
		"network.?error",
		"connection.?error",
		"connection.?refused",
		"connection.?lost",
		"other side closed",
		"fetch failed",
		"getaddrinfo",
		"ENOTFOUND",
		"EAI_AGAIN",
		"ECONNREFUSED",
		"ECONNRESET",
		"ETIMEDOUT",
		"EPIPE",
		"upstream.?connect",
		"reset before headers",
		"socket hang up",
		"socket connection was closed",
		"timed? out",
		"timeout",
		"terminated",
		"websocket.?closed",
		"websocket.?error",
	].join("|"),
	"i",
);

/** True when a failed assistant message looks like a connection/timeout/transport failure. */
export function isConnectionError(message: AssistantMessage): boolean {
	if (message.stopReason !== "error" || !message.errorMessage) return false;
	return CONNECTION_ERROR_PATTERN.test(message.errorMessage);
}
