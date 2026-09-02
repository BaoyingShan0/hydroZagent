import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuthTokensResponse } from "../../shared/hcsContracts.generated";

export type ManagedCredential = {
	accessToken: string;
	refreshToken: string;
	accessExpiresAt: number;
	user: AuthTokensResponse["user"];
};

export interface SystemBoundEncryption {
	isAvailable(): boolean;
	encrypt(value: string): Buffer;
	decrypt(value: Buffer): string;
}

type DiskEnvelope = { v: 1; ciphertext: string };

function parseDiskEnvelope(value: unknown): DiskEnvelope {
	if (
		typeof value !== "object" ||
		value === null ||
		!("v" in value) ||
		value.v !== 1 ||
		!("ciphertext" in value) ||
		typeof value.ciphertext !== "string" ||
		Object.keys(value).length !== 2
	) {
		throw new Error("受管凭证信封无效");
	}
	return { v: 1, ciphertext: value.ciphertext };
}

function parseCredential(value: unknown): ManagedCredential {
	if (
		typeof value !== "object" ||
		value === null ||
		!("accessToken" in value) ||
		typeof value.accessToken !== "string" ||
		!("refreshToken" in value) ||
		typeof value.refreshToken !== "string" ||
		!("accessExpiresAt" in value) ||
		typeof value.accessExpiresAt !== "number" ||
		!("user" in value) ||
		typeof value.user !== "object" ||
		value.user === null
	) {
		throw new Error("受管凭证内容无效");
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
		throw new Error("受管用户摘要无效");
	}
	return {
		accessToken: value.accessToken,
		refreshToken: value.refreshToken,
		accessExpiresAt: value.accessExpiresAt,
		user: { id: user.id, username: user.username, role: user.role, is_self_reported: user.is_self_reported },
	};
}

export class ManagedCredentialStore {
	private readonly path: string;
	private readonly encryption: SystemBoundEncryption;

	constructor(path: string, encryption: SystemBoundEncryption) {
		this.path = path;
		this.encryption = encryption;
	}

	assertAvailable(): void {
		if (!this.encryption.isAvailable()) throw new Error("Windows 系统绑定加密不可用，受管模式已停止");
	}

	async load(): Promise<ManagedCredential | null> {
		this.assertAvailable();
		let source: string;
		try {
			source = await readFile(this.path, "utf8");
		} catch (error: unknown) {
			if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
			throw error;
		}
		try {
			const envelope = parseDiskEnvelope(JSON.parse(source));
			const ciphertext = Buffer.from(envelope.ciphertext, "base64");
			if (ciphertext.toString("base64") !== envelope.ciphertext) throw new Error("受管凭证密文编码无效");
			return parseCredential(JSON.parse(this.encryption.decrypt(ciphertext)));
		} catch {
			await this.clear();
			throw new Error("受管凭证无法解密，已清除本地登录状态");
		}
	}

	async save(credential: ManagedCredential): Promise<void> {
		this.assertAvailable();
		await mkdir(dirname(this.path), { recursive: true });
		const encrypted = this.encryption.encrypt(JSON.stringify(credential));
		const envelope: DiskEnvelope = { v: 1, ciphertext: encrypted.toString("base64") };
		const temporary = `${this.path}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, JSON.stringify(envelope), { encoding: "utf8", mode: 0o600, flag: "wx" });
			await rename(temporary, this.path);
		} finally {
			await rm(temporary, { force: true }).catch(() => undefined);
		}
	}

	async clear(): Promise<void> {
		await rm(this.path, { force: true });
	}
}
