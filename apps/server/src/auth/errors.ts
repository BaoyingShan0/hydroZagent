import type { HcsErrorCode } from "../contracts/generated.js";

/** A safe client-facing failure; internal causes are never copied into its message. */
export class HcsRequestError extends Error {
	readonly code: HcsErrorCode;
	readonly statusCode: number;
	readonly retryAfterSeconds: number | undefined;

	constructor(code: HcsErrorCode, statusCode: number, message: string, retryAfterSeconds?: number) {
		super(message);
		this.name = "HcsRequestError";
		this.code = code;
		this.statusCode = statusCode;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

export class UsernameConflictError extends Error {
	constructor() {
		super("username conflict");
		this.name = "UsernameConflictError";
	}
}
