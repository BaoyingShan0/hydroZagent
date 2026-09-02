import { randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";

export type Argon2idParameters = {
	iterations: number;
	parallelism: number;
	memorySizeKiB: number;
	hashLength: number;
};

/** Hashes passwords with encoded Argon2id output so parameters and salt travel with the verifier. */
export class PasswordHasher {
	readonly parameters: Argon2idParameters;

	constructor(parameters: Argon2idParameters) {
		if (
			!Number.isInteger(parameters.iterations) ||
			parameters.iterations < 1 ||
			!Number.isInteger(parameters.parallelism) ||
			parameters.parallelism < 1 ||
			!Number.isInteger(parameters.memorySizeKiB) ||
			parameters.memorySizeKiB < 8192 ||
			!Number.isInteger(parameters.hashLength) ||
			parameters.hashLength < 16
		) {
			throw new Error("Invalid Argon2id parameters");
		}
		this.parameters = parameters;
	}

	async hash(password: string): Promise<string> {
		return argon2id({
			password,
			salt: randomBytes(16),
			iterations: this.parameters.iterations,
			parallelism: this.parameters.parallelism,
			memorySize: this.parameters.memorySizeKiB,
			hashLength: this.parameters.hashLength,
			outputType: "encoded",
		});
	}

	async verify(password: string, encodedHash: string): Promise<boolean> {
		try {
			return await argon2Verify({ password, hash: encodedHash });
		} catch {
			return false;
		}
	}
}
