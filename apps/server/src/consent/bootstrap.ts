import type { Pool } from "pg";
import { ConsentService } from "./consentService.js";
import { PgConsentRepository } from "./pgConsentRepository.js";

export type ConsentBootstrapResult = {
	consent: ConsentService | undefined;
	readiness: () => Promise<string[]>;
};

export async function bootstrapConsent(pool: Pool | undefined, environment: NodeJS.ProcessEnv): Promise<ConsentBootstrapResult> {
	const noticeVersion = environment.HCS_NOTICE_VERSION;
	const noticeText = environment.HCS_NOTICE_TEXT;
	const issues: string[] = [];
	if (!pool) issues.push("database_unavailable");
	if (!noticeVersion) issues.push("missing:HCS_NOTICE_VERSION");
	if (!noticeText) issues.push("missing:HCS_NOTICE_TEXT");
	if (!pool || !noticeVersion || !noticeText) {
		return { consent: undefined, readiness: async () => issues };
	}
	try {
		const consent = new ConsentService({ repository: new PgConsentRepository(pool), noticeVersion, noticeText });
		await consent.activate(new Date());
		return { consent, readiness: async () => [] };
	} catch {
		return { consent: undefined, readiness: async () => ["consent_bootstrap_failed"] };
	}
}
