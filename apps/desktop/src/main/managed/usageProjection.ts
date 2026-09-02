export type ManagedUsageMessage = {
	role?: string;
	text?: string;
};

export function managedAssistantFinal(
	messages: readonly ManagedUsageMessage[],
	messageStartIndex: number,
	status: "completed" | "aborted" | "error",
): string | null {
	if (status !== "completed") return null;
	const start = Math.max(0, Math.min(messageStartIndex, messages.length));
	for (let index = messages.length - 1; index >= start; index -= 1) {
		const message = messages[index];
		if (message?.role === "assistant") return message.text ?? "";
	}
	return null;
}
