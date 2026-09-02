const RESERVED_USERNAMES = new Set([
	"admin",
	"administrator",
	"anonymous",
	"hydro",
	"hydro-admin",
	"hydro-hcs",
	"root",
	"system",
	"support",
]);

const COMMON_PASSWORDS = new Set([
	"123456789012",
	"admin123456",
	"password1234",
	"qwerty123456",
	"welcome12345",
]);

const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export type PasswordPolicyResult = { valid: true } | { valid: false; reason: string };
export type UsernamePolicyResult = { valid: true; canonicalUsername: string } | { valid: false; reason: string };

export function validateUsername(username: string): UsernamePolicyResult {
	const canonicalUsername = username.trim().toLowerCase();
	if (canonicalUsername.length < 3 || canonicalUsername.length > 64 || !USERNAME_PATTERN.test(canonicalUsername)) {
		return { valid: false, reason: "账号名须为 3–64 位 ASCII 字母、数字、点、下划线或连字符" };
	}
	if (RESERVED_USERNAMES.has(canonicalUsername)) return { valid: false, reason: "该账号名不可注册" };
	return { valid: true, canonicalUsername };
}

export function validatePassword(password: string, canonicalUsername: string): PasswordPolicyResult {
	if (password.length < 12 || password.length > 128) return { valid: false, reason: "密码长度须为 12–128 个字符" };
	const normalizedPassword = password.toLowerCase();
	if (COMMON_PASSWORDS.has(normalizedPassword)) return { valid: false, reason: "密码过于常见" };
	if (normalizedPassword.includes(canonicalUsername)) return { valid: false, reason: "密码不得包含账号名" };
	return { valid: true };
}
