import { describe, expect, it } from "vitest";
import { LifecycleService } from "../src/lifecycle/lifecycleService.js";
import type {
	BackupKeyReferenceProbe,
	CleanupCounts,
	CleanupPolicy,
	LifecycleAlertSink,
	LifecycleRepository,
} from "../src/lifecycle/repository.js";

const POLICY: CleanupPolicy = {
	usageRetentionSeconds: 100,
	consentRetentionSeconds: 100,
	modelCallRetentionSeconds: 200,
	authSessionRetentionSeconds: 300,
	passwordResetRetentionSeconds: 400,
	auditRetentionSeconds: 500,
	proxyMaximumTimeoutSeconds: 30,
};
const EMPTY_COUNTS: CleanupCounts = {
	usageRecords: 0,
	consents: 0,
	modelCalls: 0,
	authSessions: 0,
	passwordResets: 0,
	audits: 0,
	anonymizedUsers: 0,
	recoveredCalls: 0,
};

class MemoryLifecycleRepository implements LifecycleRepository {
	recoveryCutoff: Date | null = null;
	databaseReferences = 0;
	failCleanup = false;

	async recoverInterruptedCalls(cutoff: Date): Promise<number> {
		this.recoveryCutoff = cutoff;
		return 2;
	}

	async cleanup(): Promise<CleanupCounts> {
		if (this.failCleanup) throw new Error("database unavailable");
		return EMPTY_COUNTS;
	}

	async countKeyReferences(): Promise<number> {
		return this.databaseReferences;
	}
}

class MemoryBackupProbe implements BackupKeyReferenceProbe {
	references = 0;
	async countUnexpiredReferences(): Promise<number> {
		return this.references;
	}
}

class MemoryAlertSink implements LifecycleAlertSink {
	readonly events: Array<{ code: "lifecycle_cleanup_failed"; at: Date }> = [];
	async notify(event: { code: "lifecycle_cleanup_failed"; at: Date }): Promise<void> {
		this.events.push(event);
	}
}

function service(options: {
	repository?: MemoryLifecycleRepository;
	backupProbe?: MemoryBackupProbe;
	alertSink?: MemoryAlertSink;
	policy?: CleanupPolicy;
} = {}): LifecycleService {
	return new LifecycleService({
		repository: options.repository ?? new MemoryLifecycleRepository(),
		backupProbe: options.backupProbe ?? new MemoryBackupProbe(),
		alertSink: options.alertSink ?? new MemoryAlertSink(),
		policy: options.policy ?? POLICY,
		intervalSeconds: 60,
	});
}

describe("LifecycleService", () => {
	it("recovers calls older than the maximum proxy timeout", async () => {
		const repository = new MemoryLifecycleRepository();
		const now = new Date("2026-09-01T00:01:00.000Z");
		expect(await service({ repository }).recover(now)).toBe(2);
		expect(repository.recoveryCutoff).toEqual(new Date("2026-09-01T00:00:30.000Z"));
	});

	it("alerts on cleanup failure while preserving the failure for scheduler retry", async () => {
		const repository = new MemoryLifecycleRepository();
		repository.failCleanup = true;
		const alertSink = new MemoryAlertSink();
		const now = new Date("2026-09-01T00:00:00.000Z");
		await expect(service({ repository, alertSink }).runCleanup(now)).rejects.toThrow("database unavailable");
		expect(alertSink.events).toEqual([{ code: "lifecycle_cleanup_failed", at: now }]);
	});

	it("allows key destruction only when neither primary data nor unexpired backups reference it", async () => {
		const repository = new MemoryLifecycleRepository();
		const backupProbe = new MemoryBackupProbe();
		const lifecycle = service({ repository, backupProbe });
		repository.databaseReferences = 1;
		expect(await lifecycle.canDestroyKey("key-1")).toBe(false);
		repository.databaseReferences = 0;
		backupProbe.references = 1;
		expect(await lifecycle.canDestroyKey("key-1")).toBe(false);
		backupProbe.references = 0;
		expect(await lifecycle.canDestroyKey("key-1")).toBe(true);
	});

	it("rejects an audit retention shorter than password reset retention", () => {
		expect(() => service({ policy: { ...POLICY, auditRetentionSeconds: 399 } })).toThrow(
			"Audit retention must not be shorter",
		);
	});
});
