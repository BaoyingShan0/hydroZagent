import { randomBytes, randomUUID } from "node:crypto";
import { HcsRequestError, UsernameConflictError } from "../auth/errors.js";
import { PasswordHasher } from "../auth/passwordHasher.js";
import { validatePassword } from "../auth/passwordPolicy.js";
import { hashOpaqueToken } from "../auth/tokenService.js";
import type { AdminActor, AdminRepository, AdminUserRole } from "./types.js";

const ADMIN_USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function normalizeManagedUsername(username: string): string {
	const normalized = username.trim().toLowerCase();
	if (normalized.length < 3 || normalized.length > 64 || !ADMIN_USERNAME_PATTERN.test(normalized)) {
		throw new HcsRequestError("invalid_request", 400, "账号名格式不正确");
	}
	return normalized;
}

function osPrincipal(actor: AdminActor): string {
	if (actor.type !== "os_operator") throw new HcsRequestError("unauthorized", 403, "该命令要求受信 sudo 操作者");
	return actor.principal;
}

export class AdminService {
	private readonly repository: AdminRepository;
	private readonly passwordHasher: PasswordHasher;
	private readonly resetTtlSeconds: number;

	constructor(options: { repository: AdminRepository; passwordHasher: PasswordHasher; resetTtlSeconds: number }) {
		this.repository = options.repository;
		this.passwordHasher = options.passwordHasher;
		this.resetTtlSeconds = options.resetTtlSeconds;
	}

	async seedFirstAdmin(username: string, password: string, actor: AdminActor, now: Date): Promise<void> {
		if (actor.type !== "system") throw new HcsRequestError("unauthorized", 403, "seed 只能使用 system 主体");
		const normalized = normalizeManagedUsername(username);
		const passwordResult = validatePassword(password, normalized);
		if (!passwordResult.valid) throw new HcsRequestError("invalid_request", 400, passwordResult.reason);
		try {
			await this.repository.seedFirstAdmin({
				userId: randomUUID(),
				username: normalized,
				passwordHash: await this.passwordHasher.hash(password),
				auditId: randomUUID(),
				at: now,
			});
		} catch (error: unknown) {
			if (error instanceof UsernameConflictError) throw new HcsRequestError("invalid_request", 409, "首管理员已存在");
			throw error;
		}
	}

	async createUser(
		username: string,
		password: string,
		role: AdminUserRole,
		actor: AdminActor,
		now: Date,
	): Promise<void> {
		const principal = osPrincipal(actor);
		const normalized = normalizeManagedUsername(username);
		const passwordResult = validatePassword(password, normalized);
		if (!passwordResult.valid) throw new HcsRequestError("invalid_request", 400, passwordResult.reason);
		try {
			await this.repository.createUser({
				userId: randomUUID(),
				username: normalized,
				passwordHash: await this.passwordHasher.hash(password),
				role,
				actorPrincipal: principal,
				auditId: randomUUID(),
				at: now,
			});
		} catch (error: unknown) {
			if (error instanceof UsernameConflictError) throw new HcsRequestError("invalid_request", 409, "无法使用该账号名");
			throw error;
		}
	}

	async setRole(username: string, role: AdminUserRole, actor: AdminActor, now: Date): Promise<void> {
		const changed = await this.repository.setRole({
			username: normalizeManagedUsername(username),
			role,
			actorPrincipal: osPrincipal(actor),
			auditId: randomUUID(),
			at: now,
		});
		if (!changed) throw new HcsRequestError("invalid_request", 404, "账号不存在");
	}

	async deleteUsage(eventId: string, actor: AdminActor, now: Date): Promise<void> {
		if (!UUID_PATTERN.test(eventId)) throw new HcsRequestError("invalid_request", 400, "event_id 格式不正确");
		const deleted = await this.repository.deleteUsage({
			eventId,
			actorPrincipal: osPrincipal(actor),
			auditId: randomUUID(),
			at: now,
		});
		if (!deleted) throw new HcsRequestError("invalid_request", 404, "使用记录不存在");
	}

	async issuePasswordReset(username: string, actor: AdminActor, now: Date): Promise<string> {
		const token = randomBytes(32).toString("base64url");
		const issued = await this.repository.issuePasswordReset({
			username: normalizeManagedUsername(username),
			tokenHash: hashOpaqueToken(token),
			resetId: randomUUID(),
			expiresAt: new Date(now.getTime() + this.resetTtlSeconds * 1000),
			actorPrincipal: osPrincipal(actor),
			auditId: randomUUID(),
			at: now,
		});
		if (!issued) throw new HcsRequestError("invalid_request", 404, "账号不存在或已停用");
		return token;
	}
}
