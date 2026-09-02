import type { AdminActor, AdminUserRole } from "./types.js";

export type AdminCommand =
	| { name: "seed"; username: string; passwordStdin: true }
	| { name: "create-user"; username: string; role: AdminUserRole; passwordStdin: true }
	| { name: "set-role"; username: string; role: AdminUserRole }
	| { name: "delete-usage"; eventId: string }
	| { name: "issue-reset"; username: string };

type ParsedOptions = Map<string, string | true>;

function parseOptions(values: string[]): ParsedOptions {
	const options = new Map<string, string | true>();
	for (let index = 0; index < values.length; index += 1) {
		const name = values[index];
		if (!name?.startsWith("--") || options.has(name)) throw new Error("Invalid or duplicate CLI option");
		if (name === "--password-stdin") {
			options.set(name, true);
			continue;
		}
		const value = values[index + 1];
		if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
		options.set(name, value);
		index += 1;
	}
	return options;
}

function stringOption(options: ParsedOptions, name: string): string {
	const value = options.get(name);
	if (typeof value !== "string") throw new Error(`Missing ${name}`);
	return value;
}

function roleOption(options: ParsedOptions): AdminUserRole {
	const role = stringOption(options, "--role");
	if (role !== "user" && role !== "admin") throw new Error("--role must be user or admin");
	return role;
}

function assertOnly(options: ParsedOptions, allowed: string[]): void {
	for (const name of options.keys()) {
		if (!allowed.includes(name)) throw new Error(`Unsupported option ${name}`);
	}
}

export function parseAdminCommand(argv: string[]): AdminCommand {
	if (argv[0] !== "admin" || !argv[1]) throw new Error("Usage: hydro-hcs admin <subcommand>");
	const name = argv[1];
	const options = parseOptions(argv.slice(2));
	if (name === "seed") {
		assertOnly(options, ["--username", "--password-stdin"]);
		if (options.get("--password-stdin") !== true) throw new Error("seed requires --password-stdin");
		return { name, username: stringOption(options, "--username"), passwordStdin: true };
	}
	if (name === "create-user") {
		assertOnly(options, ["--username", "--role", "--password-stdin"]);
		if (options.get("--password-stdin") !== true) throw new Error("create-user requires --password-stdin");
		return {
			name,
			username: stringOption(options, "--username"),
			role: roleOption(options),
			passwordStdin: true,
		};
	}
	if (name === "set-role") {
		assertOnly(options, ["--username", "--role"]);
		return { name, username: stringOption(options, "--username"), role: roleOption(options) };
	}
	if (name === "delete-usage") {
		assertOnly(options, ["--event-id"]);
		return { name, eventId: stringOption(options, "--event-id") };
	}
	if (name === "issue-reset") {
		assertOnly(options, ["--username"]);
		return { name, username: stringOption(options, "--username") };
	}
	throw new Error("Unsupported administrator subcommand");
}

export function trustedSudoActor(context: {
	platform: NodeJS.Platform;
	effectiveUid: number | undefined;
	sudoUid: string | undefined;
}): AdminActor {
	if (context.platform !== "linux" || context.effectiveUid !== 0 || !/^[1-9][0-9]*$/u.test(context.sudoUid ?? "")) {
		throw new Error("A trusted Linux sudo context with non-root SUDO_UID is required");
	}
	return { type: "os_operator", principal: `uid:${context.sudoUid}` };
}

export function assertRootSeedContext(context: { platform: NodeJS.Platform; effectiveUid: number | undefined }): void {
	if (context.platform !== "linux" || context.effectiveUid !== 0) throw new Error("seed requires Linux root");
}
