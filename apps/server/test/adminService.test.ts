import { describe, expect, it } from "vitest";
import { AdminService } from "../src/admin-cli/adminService.js";
import type { AdminRepository, AdminUserRole } from "../src/admin-cli/types.js";
import { PasswordHasher } from "../src/auth/passwordHasher.js";

type Call = { name: string; value: Record<string, unknown> };

class RecordingAdminRepository implements AdminRepository {
	readonly calls: Call[] = [];
	issueResetResult = true;

	async seedFirstAdmin(options: {
		userId: string;
		username: string;
		passwordHash: string;
		auditId: string;
		at: Date;
	}): Promise<void> {
		this.calls.push({ name: "seed", value: options });
	}

	async createUser(options: {
		userId: string;
		username: string;
		passwordHash: string;
		role: AdminUserRole;
		actorPrincipal: string;
		auditId: string;
		at: Date;
	}): Promise<void> {
		this.calls.push({ name: "create", value: options });
	}

	async setRole(options: {
		username: string;
		role: AdminUserRole;
		actorPrincipal: string;
		auditId: string;
		at: Date;
	}): Promise<boolean> {
		this.calls.push({ name: "set-role", value: options });
		return true;
	}

	async deleteUsage(options: {
		eventId: string;
		actorPrincipal: string;
		auditId: string;
		at: Date;
	}): Promise<boolean> {
		this.calls.push({ name: "delete", value: options });
		return true;
	}

	async issuePasswordReset(options: {
		username: string;
		tokenHash: string;
		resetId: string;
		expiresAt: Date;
		actorPrincipal: string;
		auditId: string;
		at: Date;
	}): Promise<boolean> {
		this.calls.push({ name: "reset", value: options });
		return this.issueResetResult;
	}
}

const hasher = new PasswordHasher({ iterations: 1, parallelism: 1, memorySizeKiB: 8192, hashLength: 32 });
const NOW = new Date("2026-09-01T00:00:00.000Z");
const OPERATOR = { type: "os_operator" as const, principal: "uid:1001" };

describe("AdminService", () => {
	it("seeds the reserved admin name only under the system actor", async () => {
		const repository = new RecordingAdminRepository();
		const service = new AdminService({ repository, passwordHasher: hasher, resetTtlSeconds: 600 });

		await service.seedFirstAdmin("admin", "correct-horse-battery-staple", { type: "system" }, NOW);

		expect(repository.calls[0]?.name).toBe("seed");
		expect(repository.calls[0]?.value.username).toBe("admin");
		expect(String(repository.calls[0]?.value.passwordHash)).toMatch(/^\$argon2id\$/u);
		await expect(service.seedFirstAdmin("admin", "correct-horse-battery-staple", OPERATOR, NOW)).rejects.toMatchObject({
			code: "unauthorized",
		});
	});

	it("records the trusted OS principal and never passes a plaintext password", async () => {
		const repository = new RecordingAdminRepository();
		const service = new AdminService({ repository, passwordHasher: hasher, resetTtlSeconds: 600 });
		const password = "correct-horse-battery-staple";

		await service.createUser("alice", password, "user", OPERATOR, NOW);

		expect(repository.calls[0]?.value.actorPrincipal).toBe("uid:1001");
		expect(JSON.stringify(repository.calls)).not.toContain(password);
	});

	it("returns a one-time reset secret while persisting only its hash", async () => {
		const repository = new RecordingAdminRepository();
		const service = new AdminService({ repository, passwordHasher: hasher, resetTtlSeconds: 600 });

		const token = await service.issuePasswordReset("alice", OPERATOR, NOW);

		expect(token).toHaveLength(43);
		expect(repository.calls[0]?.value.tokenHash).not.toBe(token);
		expect(repository.calls[0]?.value.expiresAt).toEqual(new Date(NOW.getTime() + 600_000));
	});

	it("rejects malformed usage event ids before reaching PostgreSQL", async () => {
		const repository = new RecordingAdminRepository();
		const service = new AdminService({ repository, passwordHasher: hasher, resetTtlSeconds: 600 });

		await expect(service.deleteUsage("------------------------------------", OPERATOR, NOW)).rejects.toMatchObject({
			code: "invalid_request",
			statusCode: 400,
		});
		expect(repository.calls).toHaveLength(0);
	});
});
