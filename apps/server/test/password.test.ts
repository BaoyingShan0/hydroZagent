import { describe, expect, it } from "vitest";
import { PasswordHasher } from "../src/auth/passwordHasher.js";
import { validatePassword, validateUsername } from "../src/auth/passwordPolicy.js";

const hasher = new PasswordHasher({ iterations: 1, parallelism: 1, memorySizeKiB: 8192, hashLength: 32 });

describe("password and username policy", () => {
	it("hashes with Argon2id and rejects the wrong password", async () => {
		const hash = await hasher.hash("correct-horse-battery-staple");

		expect(hash).toMatch(/^\$argon2id\$/u);
		expect(hash).not.toContain("correct-horse-battery-staple");
		expect(await hasher.verify("correct-horse-battery-staple", hash)).toBe(true);
		expect(await hasher.verify("wrong-password-value", hash)).toBe(false);
	});

	it("normalizes valid usernames and blocks reserved names", () => {
		expect(validateUsername(" Hydro.User ")).toEqual({ valid: true, canonicalUsername: "hydro.user" });
		expect(validateUsername("admin")).toEqual({ valid: false, reason: "该账号名不可注册" });
	});

	it("rejects short, common, and username-derived passwords", () => {
		expect(validatePassword("short", "alice").valid).toBe(false);
		expect(validatePassword("password1234", "alice").valid).toBe(false);
		expect(validatePassword("alice-is-not-a-secret", "alice").valid).toBe(false);
		expect(validatePassword("correct-horse-battery-staple", "alice")).toEqual({ valid: true });
	});
});
