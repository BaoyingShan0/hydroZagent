import type {
	BackupKeyReferenceProbe,
	CleanupCounts,
	CleanupPolicy,
	LifecycleAlertSink,
	LifecycleRepository,
} from "./repository.js";

export class LifecycleService {
	private readonly repository: LifecycleRepository;
	private readonly backupProbe: BackupKeyReferenceProbe;
	private readonly alertSink: LifecycleAlertSink;
	private readonly policy: CleanupPolicy;
	private readonly intervalMilliseconds: number;
	private timer: NodeJS.Timeout | null = null;

	constructor(options: {
		repository: LifecycleRepository;
		backupProbe: BackupKeyReferenceProbe;
		alertSink: LifecycleAlertSink;
		policy: CleanupPolicy;
		intervalSeconds: number;
	}) {
		if (options.policy.auditRetentionSeconds < options.policy.passwordResetRetentionSeconds) {
			throw new Error("Audit retention must not be shorter than password reset retention");
		}
		for (const value of Object.values(options.policy)) {
			if (!Number.isSafeInteger(value) || value < 1) throw new Error("Lifecycle retention values must be positive integers");
		}
		if (!Number.isSafeInteger(options.intervalSeconds) || options.intervalSeconds < 1) {
			throw new Error("Lifecycle interval must be a positive integer");
		}
		this.repository = options.repository;
		this.backupProbe = options.backupProbe;
		this.alertSink = options.alertSink;
		this.policy = options.policy;
		this.intervalMilliseconds = options.intervalSeconds * 1000;
	}

	async recover(now: Date): Promise<number> {
		const cutoff = new Date(now.getTime() - this.policy.proxyMaximumTimeoutSeconds * 1000);
		return this.repository.recoverInterruptedCalls(cutoff, now);
	}

	async runCleanup(now: Date): Promise<CleanupCounts> {
		try {
			return await this.repository.cleanup(this.policy, now);
		} catch (error: unknown) {
			await this.alertSink.notify({ code: "lifecycle_cleanup_failed", at: now }).catch(() => undefined);
			throw error;
		}
	}

	async canDestroyKey(keyId: string): Promise<boolean> {
		const [databaseReferences, backupReferences] = await Promise.all([
			this.repository.countKeyReferences(keyId),
			this.backupProbe.countUnexpiredReferences(keyId),
		]);
		return databaseReferences === 0 && backupReferences === 0;
	}

	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => void this.runCleanup(new Date()).catch(() => undefined), this.intervalMilliseconds);
		this.timer.unref();
	}

	stop(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = null;
	}
}
