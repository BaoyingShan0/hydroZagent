import type { UsageIngestRequest } from "../contracts/generated.js";

export type EncryptedUsageRecord = {
	request: UsageIngestRequest;
	userId: string;
	receivedAt: Date;
	userInput: Uint8Array;
	assistantFinal: Uint8Array | null;
	payloadFingerprint: string;
};

export type UsageIngestResult = { deduplicated: boolean; conflict: boolean };

export interface UsageRepository {
	ingest(record: EncryptedUsageRecord): Promise<UsageIngestResult>;
}
