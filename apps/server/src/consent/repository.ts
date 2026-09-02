export interface ConsentRepository {
	activateNotice(noticeVersion: string, now: Date): Promise<number>;
	recordConsent(options: {
		id: string;
		userId: string;
		noticeVersion: string;
		clientVersion: string;
		consentedAt: Date;
	}): Promise<boolean>;
	withdrawConsent(userId: string, noticeVersion: string, now: Date): Promise<boolean>;
	hasValidConsent(userId: string, noticeVersion: string): Promise<boolean>;
}
