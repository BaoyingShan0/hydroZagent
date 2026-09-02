import { describe, expect, it } from "vitest";
import { assertRootSeedContext, parseAdminCommand, trustedSudoActor } from "../src/admin-cli/command.js";

describe("administrator command boundary", () => {
	it("parses only fixed structured subcommands", () => {
		expect(parseAdminCommand(["admin", "set-role", "--username", "alice", "--role", "admin"])).toEqual({
			name: "set-role",
			username: "alice",
			role: "admin",
		});
		expect(parseAdminCommand(["admin", "delete-usage", "--event-id", "018f47d2-792e-7b1c-a720-65d74ccff101"])).toEqual({
			name: "delete-usage",
			eventId: "018f47d2-792e-7b1c-a720-65d74ccff101",
		});
	});

	it("requires password stdin and rejects shell-like or unknown parameters", () => {
		expect(() => parseAdminCommand(["admin", "create-user", "--username", "alice", "--role", "user"])).toThrow(
			/--password-stdin/u,
		);
		expect(() =>
			parseAdminCommand([
				"admin",
				"create-user",
				"--username",
				"alice",
				"--role",
				"user",
				"--password",
				"secret-on-command-line",
			]),
		).toThrow(/Unsupported option/u);
		expect(() => parseAdminCommand(["admin", "query-records"])).toThrow(/Unsupported administrator subcommand/u);
	});

	it("accepts only Linux root with a non-root original sudo UID", () => {
		expect(trustedSudoActor({ platform: "linux", effectiveUid: 0, sudoUid: "1001" })).toEqual({
			type: "os_operator",
			principal: "uid:1001",
		});
		expect(() => trustedSudoActor({ platform: "win32", effectiveUid: undefined, sudoUid: "1001" })).toThrow();
		expect(() => trustedSudoActor({ platform: "linux", effectiveUid: 1001, sudoUid: "1001" })).toThrow();
		expect(() => trustedSudoActor({ platform: "linux", effectiveUid: 0, sudoUid: "0" })).toThrow();
	});

	it("allows seed only from Linux root", () => {
		expect(() => assertRootSeedContext({ platform: "linux", effectiveUid: 0 })).not.toThrow();
		expect(() => assertRootSeedContext({ platform: "linux", effectiveUid: 1001 })).toThrow();
	});
});
