export type AdminActor =
	| { type: "system" }
	| { type: "os_operator"; principal: string };

export type AdminUserRole = "user" | "admin";

export interface AdminRepository {
	seedFirstAdmin(options: {
		userId: string;
		username: string;
		passwordHash: string;
		auditId: string;
		at: Date;
	}): Promise<void>;
	createUser(options: {
		userId: string;
		username: string;
		passwordHash: string;
		role: AdminUserRole;
		actorPrincipal: string;
		auditId: string;
		at: Date;
	}): Promise<void>;
	setRole(options: {
		username: string;
		role: AdminUserRole;
		actorPrincipal: string;
		auditId: string;
		at: Date;
	}): Promise<boolean>;
	deleteUsage(options: {
		eventId: string;
		actorPrincipal: string;
		auditId: string;
		at: Date;
	}): Promise<boolean>;
	issuePasswordReset(options: {
		username: string;
		tokenHash: string;
		resetId: string;
		expiresAt: Date;
		actorPrincipal: string;
		auditId: string;
		at: Date;
	}): Promise<boolean>;
}
