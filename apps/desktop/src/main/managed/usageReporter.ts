import type { UsageIngestRequest } from "../../shared/hcsContracts.generated";
import type { ManagedAuthManager } from "./authManager";
import { HcsClientError, type ManagedHcsClient } from "./hcsClient";

export type ManagedTurnUsage = {
	eventId: string;
	sessionId: string;
	turnId: string;
	clientCreatedAt: string;
	model: string;
	status: "completed" | "aborted" | "error";
	userInput: string;
	assistantFinal: string | null;
	anonymous: boolean;
	modelCallIds: string[];
};

export interface ManagedUsageSink {
	report(usage: ManagedTurnUsage): void;
}

const RETRY_DELAYS = [0, 500, 1_500, 3_500];

function wait(milliseconds: number): Promise<void> {
	if (milliseconds === 0) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, milliseconds);
		timer.unref?.();
	});
}

export class ManagedUsageReporter implements ManagedUsageSink {
	private readonly client: ManagedHcsClient;
	private readonly auth: ManagedAuthManager;
	private readonly clientVersion: string;
	private readonly deviceId: string;
	private readonly onFailure: () => void;
	private readonly retryDelays: readonly number[];

	constructor(options: {
		client: ManagedHcsClient;
		auth: ManagedAuthManager;
		clientVersion: string;
		deviceId: string;
		onFailure: () => void;
		retryDelays?: readonly number[];
	}) {
		this.client = options.client;
		this.auth = options.auth;
		this.clientVersion = options.clientVersion;
		this.deviceId = options.deviceId;
		this.onFailure = options.onFailure;
		this.retryDelays = options.retryDelays?.length ? [...options.retryDelays] : RETRY_DELAYS;
	}

	report(usage: ManagedTurnUsage): void {
		void this.submit(usage);
	}

	private async submit(usage: ManagedTurnUsage): Promise<void> {
		const request: UsageIngestRequest = {
			event_id: usage.eventId,
			session_id: usage.sessionId,
			turn_id: usage.turnId,
			client_created_at: usage.clientCreatedAt,
			task_category: "Knowledge",
			model: usage.model,
			client_version: this.clientVersion,
			device_id: this.deviceId,
			turn_status: usage.status,
			user_input: usage.userInput,
			assistant_final: usage.assistantFinal,
			anonymous: usage.anonymous,
			model_call_ids: usage.modelCallIds,
		};
		for (let attempt = 0; attempt < this.retryDelays.length; attempt += 1) {
			await wait(this.retryDelays[attempt] ?? 0);
			try {
				await this.client.json("POST", "/ingest/usage", {
					accessToken: await this.auth.getValidAccessToken(),
					body: request,
				});
				return;
			} catch (error: unknown) {
				const retryable =
					!(error instanceof HcsClientError) ||
					error.statusCode === 429 ||
					error.statusCode >= 500;
				if (!retryable || attempt === this.retryDelays.length - 1) break;
			}
		}
		this.onFailure();
	}
}
