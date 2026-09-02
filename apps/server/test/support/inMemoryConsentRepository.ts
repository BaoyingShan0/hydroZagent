import type { ConsentRepository } from "../../src/consent/repository.js";

type ConsentRecord = {
	id: string;
	userId: string;
	noticeVersion: string;
	clientVersion: string;
	consentedAt: Date;
	withdrawnAt: Date | null;
	invalidatedAt: Date | null;
};

export class InMemoryConsentRepository implements ConsentRepository {
	readonly records: ConsentRecord[] = [];

	async activateNotice(noticeVersion: string, now: Date): Promise<number> {
		let invalidated = 0;
		for (const record of this.records) {
			if (record.noticeVersion !== noticeVersion && !record.withdrawnAt && !record.invalidatedAt) {
				record.invalidatedAt = now;
				invalidated += 1;
			}
		}
		return invalidated;
	}

	async recordConsent(options: {
		id: string;
		userId: string;
		noticeVersion: string;
		clientVersion: string;
		consentedAt: Date;
	}): Promise<boolean> {
		const existing = this.records.some(
			(record) =>
				record.userId === options.userId &&
				record.noticeVersion === options.noticeVersion &&
				!record.withdrawnAt &&
				!record.invalidatedAt,
		);
		if (existing) return false;
		this.records.push({ ...options, withdrawnAt: null, invalidatedAt: null });
		return true;
	}

	async withdrawConsent(userId: string, noticeVersion: string, now: Date): Promise<boolean> {
		const record = this.records.find(
			(candidate) =>
				candidate.userId === userId &&
				candidate.noticeVersion === noticeVersion &&
				!candidate.withdrawnAt &&
				!candidate.invalidatedAt,
		);
		if (!record) return false;
		record.withdrawnAt = now;
		return true;
	}

	async hasValidConsent(userId: string, noticeVersion: string): Promise<boolean> {
		return this.records.some(
			(record) =>
				record.userId === userId &&
				record.noticeVersion === noticeVersion &&
				!record.withdrawnAt &&
				!record.invalidatedAt,
		);
	}
}
