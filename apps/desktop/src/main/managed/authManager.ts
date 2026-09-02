import type { AuthTokensResponse, NoticeResponse, UserSummary } from "../../shared/hcsContracts.generated";
import type { ManagedAccessStatus, ManagedConsentInput, ManagedLoginInput } from "../../shared/types/managed";
import { MANAGED_BUILD } from "./buildManifest";
import type { ManagedCredential, ManagedCredentialStore } from "./credentialStore";
import { HcsClientError, type ManagedHcsClient } from "./hcsClient";

function authTokens(value: unknown): AuthTokensResponse {
	if (
		typeof value !== "object" ||
		value === null ||
		!("access_token" in value) ||
		typeof value.access_token !== "string" ||
		!("refresh_token" in value) ||
		typeof value.refresh_token !== "string" ||
		!("expires_in" in value) ||
		typeof value.expires_in !== "number" ||
		!("token_type" in value) ||
		value.token_type !== "Bearer" ||
		!("user" in value) ||
		typeof value.user !== "object" ||
		value.user === null
	) {
		throw new Error("HCS 登录响应无效");
	}
	const user = value.user;
	if (
		!("id" in user) ||
		typeof user.id !== "string" ||
		!("username" in user) ||
		typeof user.username !== "string" ||
		!("role" in user) ||
		(user.role !== "user" && user.role !== "admin") ||
		!("is_self_reported" in user) ||
		typeof user.is_self_reported !== "boolean"
	) {
		throw new Error("HCS 用户摘要无效");
	}
	return {
		access_token: value.access_token,
		refresh_token: value.refresh_token,
		token_type: "Bearer",
		expires_in: value.expires_in,
		user: { id: user.id, username: user.username, role: user.role, is_self_reported: user.is_self_reported },
	};
}

function notice(value: unknown): NoticeResponse {
	if (
		typeof value !== "object" ||
		value === null ||
		!("notice_version" in value) ||
		typeof value.notice_version !== "string" ||
		!("text" in value) ||
		typeof value.text !== "string"
	) {
		throw new Error("HCS 告知响应无效");
	}
	return { notice_version: value.notice_version, text: value.text };
}

export class ManagedAuthManager {
	private readonly client: ManagedHcsClient;
	private readonly store: ManagedCredentialStore;
	private credential: ManagedCredential | null = null;
	private failure: ManagedAccessStatus["failure"] = null;
	private refreshing: Promise<string> | null = null;
	private consentState: ManagedAccessStatus["consent"] = "unknown";
	private readonly deviceId: string;
	private readonly clientVersion: string;
	private readonly onAccessLost: () => void;

	constructor(
		client: ManagedHcsClient,
		store: ManagedCredentialStore,
		options: { deviceId: string; clientVersion: string; onAccessLost?: () => void },
	) {
		this.client = client;
		this.store = store;
		this.deviceId = options.deviceId;
		this.clientVersion = options.clientVersion;
		this.onAccessLost = options.onAccessLost ?? (() => undefined);
	}

	async initialize(): Promise<void> {
		if (!MANAGED_BUILD.managed) return;
		try {
			this.store.assertAvailable();
			this.credential = await this.store.load();
			if (this.credential) await this.synchronizeConsent();
		} catch (error: unknown) {
			this.credential = null;
			this.failure = error instanceof Error && error.message.includes("系统绑定加密不可用")
				? "encryption_unavailable"
				: "credential_invalid";
		}
	}

	status(): ManagedAccessStatus {
		return {
			managed: MANAGED_BUILD.managed,
			authenticated: this.credential !== null,
			user: this.credential?.user ?? null,
			failure: this.failure,
			consent: this.consentState,
		};
	}

	async login(input: ManagedLoginInput, register: boolean): Promise<ManagedAccessStatus> {
		if (!MANAGED_BUILD.managed) throw new Error("当前不是受管构建");
		this.store.assertAvailable();
		const response = await this.client.json("POST", register ? "/auth/register" : "/auth/login", {
			body: {
				username: input.username,
				password: input.password,
				device_id: this.deviceId,
				client_version: this.clientVersion,
			},
		});
		await this.acceptTokens(authTokens(response.body));
		await this.synchronizeConsent();
		this.failure = null;
		return this.status();
	}

	async currentNotice(): Promise<NoticeResponse> {
		return notice((await this.client.json("GET", "/auth/notice")).body);
	}

	async consent(input: ManagedConsentInput): Promise<void> {
		const token = await this.getValidAccessToken();
		await this.client.json("POST", "/auth/consent", {
			accessToken: token,
			body: { notice_version: input.noticeVersion, client_version: this.clientVersion },
		});
		this.consentState = "valid";
	}

	async withdraw(): Promise<void> {
		const token = await this.getValidAccessToken();
		await this.client.json("POST", "/auth/withdraw-consent", { accessToken: token });
		this.consentState = "required";
		this.onAccessLost();
	}

	async logout(): Promise<void> {
		try {
			if (this.credential) await this.client.json("POST", "/auth/logout", { accessToken: this.credential.accessToken });
		} finally {
			await this.clear();
		}
	}

	async deactivate(): Promise<void> {
		try {
			await this.client.json("POST", "/auth/deactivate", { accessToken: await this.getValidAccessToken() });
		} finally {
			await this.clear();
		}
	}

	async getValidAccessToken(forceRefresh = false): Promise<string> {
		if (!this.credential) throw new HcsClientError(401, "unauthorized", "请先登录");
		if (!forceRefresh && this.credential.accessExpiresAt - Date.now() > 60_000) return this.credential.accessToken;
		if (!this.refreshing) {
			this.refreshing = this.refresh().finally(() => {
				this.refreshing = null;
			});
		}
		return this.refreshing;
	}

	private async refresh(): Promise<string> {
		if (!this.credential) throw new HcsClientError(401, "unauthorized", "请先登录");
		try {
			const response = await this.client.json("POST", "/auth/refresh", {
				body: { refresh_token: this.credential.refreshToken },
			});
			const tokens = authTokens(response.body);
			await this.acceptTokens(tokens);
			return tokens.access_token;
		} catch (error: unknown) {
			await this.clear();
			throw error;
		}
	}

	private async acceptTokens(tokens: AuthTokensResponse): Promise<void> {
		const credential: ManagedCredential = {
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			accessExpiresAt: Date.now() + tokens.expires_in * 1000,
			user: tokens.user,
		};
		await this.store.save(credential);
		this.credential = credential;
	}

	private async clear(): Promise<void> {
		this.credential = null;
		this.consentState = "unknown";
		await this.store.clear();
		this.onAccessLost();
	}

	private async synchronizeConsent(): Promise<void> {
		try {
			await this.client.json("GET", "/proxy/v1/models", { accessToken: await this.getValidAccessToken() });
			this.consentState = "valid";
		} catch (error: unknown) {
			if (error instanceof HcsClientError && error.code === "consent_required") {
				this.consentState = "required";
				return;
			}
			if (error instanceof HcsClientError && error.statusCode === 401) await this.clear();
			this.consentState = "unknown";
		}
	}
}
