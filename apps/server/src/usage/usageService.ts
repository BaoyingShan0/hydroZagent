import type { UsageIngestRequest, UsageIngestResponse } from "../contracts/generated.js";
import { HcsRequestError } from "../auth/errors.js";
import type { UsageFieldName, UsageKeyring } from "./encryption.js";
import type { UsageRepository } from "./repository.js";

function canonicalPayload(request: UsageIngestRequest): string {
	return JSON.stringify([
		request.event_id,
		request.session_id,
		request.turn_id,
		request.client_created_at,
		request.task_category,
		request.model,
		request.client_version,
		request.device_id,
		request.turn_status,
		request.user_input,
		request.assistant_final ?? null,
		request.anonymous,
		[...request.model_call_ids].sort(),
	]);
}

export class UsageService {
	private readonly repository: UsageRepository;
	private readonly keyring: UsageKeyring;
	private readonly maximumPayloadBytes: number;

	constructor(options: { repository: UsageRepository; keyring: UsageKeyring; maximumPayloadBytes: number }) {
		if (!Number.isSafeInteger(options.maximumPayloadBytes) || options.maximumPayloadBytes < 1) {
			throw new Error("Usage maximum payload must be a positive integer");
		}
		this.repository = options.repository;
		this.keyring = options.keyring;
		this.maximumPayloadBytes = options.maximumPayloadBytes;
	}

	async ingest(request: UsageIngestRequest, userId: string, receivedAt: Date): Promise<UsageIngestResponse> {
		const serialized = canonicalPayload(request);
		if (Buffer.byteLength(serialized, "utf8") > this.maximumPayloadBytes) {
			throw new HcsRequestError("payload_too_large", 413, "使用记录超过大小限制");
		}
		const result = await this.repository.ingest({
			request,
			userId,
			receivedAt,
			userInput: this.keyring.encrypt(request.user_input, request.event_id, userId, "user_input"),
			assistantFinal:
				request.assistant_final === undefined || request.assistant_final === null
					? null
					: this.keyring.encrypt(request.assistant_final, request.event_id, userId, "assistant_final"),
			payloadFingerprint: this.keyring.fingerprint(serialized),
		});
		return { accepted: true, deduplicated: result.deduplicated };
	}

	decrypt(serialized: Uint8Array, eventId: string, userId: string, fieldName: UsageFieldName): string {
		return this.keyring.decrypt(serialized, eventId, userId, fieldName);
	}

	prepareLazyReencryption(
		serialized: Uint8Array,
		eventId: string,
		userId: string,
		fieldName: UsageFieldName,
	): Uint8Array | null {
		return this.keyring.reencrypt(serialized, eventId, userId, fieldName);
	}
}
