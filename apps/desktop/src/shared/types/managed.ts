import type { NoticeResponse, UserSummary } from "../hcsContracts.generated";

export type ManagedAccessStatus = {
	managed: boolean;
	authenticated: boolean;
	user: UserSummary | null;
	failure: "encryption_unavailable" | "credential_invalid" | null;
	consent: "unknown" | "required" | "valid";
};

export type ManagedLoginInput = {
	username: string;
	password: string;
};

export type ManagedConsentInput = {
	noticeVersion: string;
};

export type ManagedNotice = NoticeResponse;
