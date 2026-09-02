import type { ModelCallSettlement, ProxyCallRepository } from "../../src/proxy/repository.js";

export type RecordedProxyCall = {
	id: string;
	userId: string;
	model: string;
	startedAt: Date;
	settlement: ModelCallSettlement | null;
};

export class InMemoryProxyCallRepository implements ProxyCallRepository {
	readonly calls: RecordedProxyCall[] = [];

	async start(options: { id: string; userId: string; model: string; startedAt: Date }): Promise<void> {
		this.calls.push({ ...options, settlement: null });
	}

	async settle(id: string, settlement: ModelCallSettlement): Promise<void> {
		const call = this.calls.find((candidate) => candidate.id === id);
		if (!call || call.settlement) throw new Error("Proxy call settlement invariant violated");
		call.settlement = settlement;
	}
}
