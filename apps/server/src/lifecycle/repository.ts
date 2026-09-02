export type CleanupPolicy = {
	usageRetentionSeconds: number;
	consentRetentionSeconds: number;
	modelCallRetentionSeconds: number;
	authSessionRetentionSeconds: number;
	passwordResetRetentionSeconds: number;
	auditRetentionSeconds: number;
	proxyMaximumTimeoutSeconds: number;
};

export type CleanupCounts = {
	usageRecords: number;
	consents: number;
	modelCalls: number;
	authSessions: number;
	passwordResets: number;
	audits: number;
	anonymizedUsers: number;
	recoveredCalls: number;
};

export interface LifecycleRepository {
	recoverInterruptedCalls(cutoff: Date, now: Date): Promise<number>;
	cleanup(policy: CleanupPolicy, now: Date): Promise<CleanupCounts>;
	countKeyReferences(keyId: string): Promise<number>;
}

export interface BackupKeyReferenceProbe {
	countUnexpiredReferences(keyId: string): Promise<number>;
}

export interface LifecycleAlertSink {
	notify(event: { code: "lifecycle_cleanup_failed"; at: Date }): Promise<void>;
}
