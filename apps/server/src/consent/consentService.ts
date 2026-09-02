import { randomUUID } from "node:crypto";
import { HcsRequestError } from "../auth/errors.js";
import type { ConsentRepository } from "./repository.js";

export type Notice = {
	notice_version: string;
	text: string;
};

export class ConsentService {
	readonly notice: Notice;
	private readonly repository: ConsentRepository;

	constructor(options: { repository: ConsentRepository; noticeVersion: string; noticeText: string }) {
		if (!options.noticeVersion || options.noticeVersion.length > 64 || !options.noticeText || options.noticeText.length > 32_768) {
			throw new Error("Invalid consent notice configuration");
		}
		this.repository = options.repository;
		this.notice = { notice_version: options.noticeVersion, text: options.noticeText };
	}

	async activate(now: Date): Promise<number> {
		return this.repository.activateNotice(this.notice.notice_version, now);
	}

	async consent(userId: string, noticeVersion: string, clientVersion: string, now: Date): Promise<boolean> {
		if (noticeVersion !== this.notice.notice_version) {
			throw new HcsRequestError("consent_required", 403, "告知版本已更新，请重新确认");
		}
		return this.repository.recordConsent({
			id: randomUUID(),
			userId,
			noticeVersion,
			clientVersion,
			consentedAt: now,
		});
	}

	async withdraw(userId: string, now: Date): Promise<boolean> {
		return this.repository.withdrawConsent(userId, this.notice.notice_version, now);
	}

	async assertValidConsent(userId: string): Promise<void> {
		if (!(await this.repository.hasValidConsent(userId, this.notice.notice_version))) {
			throw new HcsRequestError("consent_required", 403, "需要同意当前告知版本");
		}
	}
}
