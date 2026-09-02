import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { LifecycleService } from "./lifecycleService.js";
import { PgLifecycleRepository } from "./pgLifecycleRepository.js";
import type { BackupKeyReferenceProbe, LifecycleAlertSink } from "./repository.js";

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((candidate: unknown) => typeof candidate === "string");
}

class FileBackupKeyReferenceProbe implements BackupKeyReferenceProbe {
	private readonly path: string;

	constructor(path: string) {
		this.path = path;
	}

	async countUnexpiredReferences(keyId: string): Promise<number> {
		const value: unknown = JSON.parse(await readFile(this.path, "utf8"));
		if (typeof value !== "object" || value === null || !("backups" in value) || !Array.isArray(value.backups)) {
			throw new Error("Invalid backup key manifest");
		}
		let references = 0;
		for (const backup of value.backups) {
			if (
				typeof backup !== "object" ||
				backup === null ||
				!("expires_at" in backup) ||
				typeof backup.expires_at !== "string" ||
				!("key_ids" in backup) ||
				!isStringArray(backup.key_ids)
			) {
				throw new Error("Invalid backup key manifest");
			}
			const expiresAt = new Date(backup.expires_at);
			if (!Number.isFinite(expiresAt.getTime())) throw new Error("Invalid backup key manifest");
			if (expiresAt.getTime() > Date.now() && backup.key_ids.includes(keyId)) references += 1;
		}
		return references;
	}
}

class StderrLifecycleAlertSink implements LifecycleAlertSink {
	async notify(event: { code: "lifecycle_cleanup_failed"; at: Date }): Promise<void> {
		process.stderr.write(`${JSON.stringify({ level: "error", event: event.code, at: event.at.toISOString() })}\n`);
	}
}

export type LifecycleBootstrapResult = {
	lifecycle: LifecycleService | undefined;
	readiness: () => Promise<string[]>;
	close: () => Promise<void>;
};

const REQUIRED_SETTINGS = [
	"HCS_USAGE_RETENTION_SECONDS",
	"HCS_CONSENT_RETENTION_SECONDS",
	"HCS_MODEL_CALL_RETENTION_SECONDS",
	"HCS_AUTH_SESSION_RETENTION_SECONDS",
	"HCS_PASSWORD_RESET_RETENTION_SECONDS",
	"HCS_AUDIT_RETENTION_SECONDS",
	"HCS_PROXY_MAX_TIMEOUT_SECONDS",
	"HCS_LIFECYCLE_INTERVAL_SECONDS",
	"HCS_BACKUP_KEY_MANIFEST_PATH",
] as const;

function positiveInteger(environment: NodeJS.ProcessEnv, name: (typeof REQUIRED_SETTINGS)[number]): number {
	const value = Number(environment[name]);
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
	return value;
}

export async function bootstrapLifecycle(pool: Pool | undefined, environment: NodeJS.ProcessEnv): Promise<LifecycleBootstrapResult> {
	const missing = REQUIRED_SETTINGS.filter((name) => !environment[name]);
	if (!pool || missing.length > 0) {
		const issues = [...missing.map((name) => `missing:${name}`), ...(pool ? [] : ["database_unavailable"])];
		return { lifecycle: undefined, readiness: async () => issues, close: async () => undefined };
	}
	const backupManifestPath = environment.HCS_BACKUP_KEY_MANIFEST_PATH;
	if (!backupManifestPath) {
		return { lifecycle: undefined, readiness: async () => ["lifecycle_configuration_invalid"], close: async () => undefined };
	}
	try {
		const backupProbe = new FileBackupKeyReferenceProbe(backupManifestPath);
		await backupProbe.countUnexpiredReferences("readiness-probe");
		const lifecycle = new LifecycleService({
			repository: new PgLifecycleRepository(pool),
			backupProbe,
			alertSink: new StderrLifecycleAlertSink(),
			policy: {
				usageRetentionSeconds: positiveInteger(environment, "HCS_USAGE_RETENTION_SECONDS"),
				consentRetentionSeconds: positiveInteger(environment, "HCS_CONSENT_RETENTION_SECONDS"),
				modelCallRetentionSeconds: positiveInteger(environment, "HCS_MODEL_CALL_RETENTION_SECONDS"),
				authSessionRetentionSeconds: positiveInteger(environment, "HCS_AUTH_SESSION_RETENTION_SECONDS"),
				passwordResetRetentionSeconds: positiveInteger(environment, "HCS_PASSWORD_RESET_RETENTION_SECONDS"),
				auditRetentionSeconds: positiveInteger(environment, "HCS_AUDIT_RETENTION_SECONDS"),
				proxyMaximumTimeoutSeconds: positiveInteger(environment, "HCS_PROXY_MAX_TIMEOUT_SECONDS"),
			},
			intervalSeconds: positiveInteger(environment, "HCS_LIFECYCLE_INTERVAL_SECONDS"),
		});
		await lifecycle.recover(new Date());
		lifecycle.start();
		return { lifecycle, readiness: async () => [], close: async () => lifecycle.stop() };
	} catch {
		return { lifecycle: undefined, readiness: async () => ["lifecycle_bootstrap_failed"], close: async () => undefined };
	}
}
