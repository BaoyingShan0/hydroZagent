export type ModelCallSettlement = {
	status: "completed" | "error" | "cancelled";
	endedAt: Date;
	errorCode: string | null;
	promptTokens: number | null;
	completionTokens: number | null;
	latencyMs: number;
};

export interface ProxyCallRepository {
	start(options: { id: string; userId: string; model: string; startedAt: Date }): Promise<void>;
	settle(id: string, settlement: ModelCallSettlement): Promise<void>;
}
