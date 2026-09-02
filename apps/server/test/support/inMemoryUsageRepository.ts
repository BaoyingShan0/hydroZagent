import type { EncryptedUsageRecord, UsageIngestResult, UsageRepository } from "../../src/usage/repository.js";

export class InMemoryUsageRepository implements UsageRepository {
	readonly records = new Map<string, EncryptedUsageRecord>();
	readonly conflicts: string[] = [];

	async ingest(record: EncryptedUsageRecord): Promise<UsageIngestResult> {
		const existing = this.records.get(record.request.event_id);
		if (existing) {
			const conflict = existing.payloadFingerprint !== record.payloadFingerprint;
			if (conflict) this.conflicts.push(record.request.event_id);
			return { deduplicated: true, conflict };
		}
		this.records.set(record.request.event_id, record);
		return { deduplicated: false, conflict: false };
	}
}
