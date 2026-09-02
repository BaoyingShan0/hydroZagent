#!/usr/bin/env node

import { createDatabasePool } from "../db/pool.js";
import { HcsRequestError } from "../auth/errors.js";
import { PasswordHasher } from "../auth/passwordHasher.js";
import { AdminService } from "./adminService.js";
import { assertRootSeedContext, parseAdminCommand, trustedSudoActor } from "./command.js";
import { PgAdminRepository } from "./pgAdminRepository.js";

function required(environment: NodeJS.ProcessEnv, name: string): string {
	const value = environment[name];
	if (!value) throw new Error(`Missing required administrator setting ${name}`);
	return value;
}

function positiveInteger(environment: NodeJS.ProcessEnv, name: string): number {
	const value = Number(required(environment, name));
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
	return value;
}

async function readPasswordFromStdin(): Promise<string> {
	process.stdin.setEncoding("utf8");
	let input = "";
	for await (const chunk of process.stdin) {
		const value: unknown = chunk;
		if (typeof value !== "string") throw new Error("stdin password must be UTF-8 text");
		input += value;
		if (input.length > 1024) throw new Error("stdin password input is too large");
	}
	const password = input.replace(/[\r\n]+$/u, "");
	if (password.length === 0 || password.length > 128) throw new Error("stdin password length is invalid");
	return password;
}

async function execute(): Promise<void> {
	const command = parseAdminCommand(process.argv.slice(2));
	const databaseUrl = required(process.env, "HCS_DATABASE_URL");
	const passwordHasher = new PasswordHasher({
		iterations: positiveInteger(process.env, "HCS_ARGON2_ITERATIONS"),
		parallelism: positiveInteger(process.env, "HCS_ARGON2_PARALLELISM"),
		memorySizeKiB: positiveInteger(process.env, "HCS_ARGON2_MEMORY_KIB"),
		hashLength: positiveInteger(process.env, "HCS_ARGON2_HASH_LENGTH"),
	});
	const pool = createDatabasePool(databaseUrl);
	try {
		const service = new AdminService({
			repository: new PgAdminRepository(pool),
			passwordHasher,
			resetTtlSeconds: positiveInteger(process.env, "HCS_PASSWORD_RESET_TTL_SECONDS"),
		});
		const effectiveUid = process.getuid?.();
		if (command.name === "seed") {
			assertRootSeedContext({ platform: process.platform, effectiveUid });
			if (process.env.HCS_ALLOW_SEED !== "true") throw new Error("HCS_ALLOW_SEED=true is required for seed");
			await service.seedFirstAdmin(command.username, await readPasswordFromStdin(), { type: "system" }, new Date());
			process.stdout.write("First administrator created.\n");
			return;
		}
		const actor = trustedSudoActor({ platform: process.platform, effectiveUid, sudoUid: process.env.SUDO_UID });
		if (command.name === "create-user") {
			await service.createUser(command.username, await readPasswordFromStdin(), command.role, actor, new Date());
			process.stdout.write("User created.\n");
			return;
		}
		if (command.name === "set-role") {
			await service.setRole(command.username, command.role, actor, new Date());
			process.stdout.write("Role updated.\n");
			return;
		}
		if (command.name === "delete-usage") {
			await service.deleteUsage(command.eventId, actor, new Date());
			process.stdout.write("Usage record deleted.\n");
			return;
		}
		const token = await service.issuePasswordReset(command.username, actor, new Date());
		process.stdout.write(`${token}\n`);
	} finally {
		await pool.end();
	}
}

await execute().catch((error: unknown) => {
	if (error instanceof HcsRequestError) {
		process.stderr.write(`${error.code}: ${error.message}\n`);
	} else {
		process.stderr.write("Administrator command failed.\n");
	}
	process.exitCode = 1;
});
