import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type DeviceIdentityEnvelope = { v: 1; deviceId: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function hasCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function parseEnvelope(source: string): DeviceIdentityEnvelope | null {
	try {
		const value: unknown = JSON.parse(source);
		if (
			typeof value !== "object" ||
			value === null ||
			!("v" in value) ||
			value.v !== 1 ||
			!("deviceId" in value) ||
			typeof value.deviceId !== "string" ||
			!UUID_PATTERN.test(value.deviceId) ||
			Object.keys(value).length !== 2
		) {
			return null;
		}
		return { v: 1, deviceId: value.deviceId };
	} catch {
		return null;
	}
}

/** Owns the stable, non-secret installation identifier used in HCS audit metadata. */
export class ManagedDeviceIdentityStore {
	private readonly path: string;

	constructor(path: string) {
		this.path = path;
	}

	async loadOrCreate(): Promise<string> {
		try {
			const existing = parseEnvelope(await readFile(this.path, "utf8"));
			if (existing) return existing.deviceId;
			await rm(this.path, { force: true });
		} catch (error: unknown) {
			if (!hasCode(error, "ENOENT")) throw error;
		}

		const deviceId = randomUUID();
		const temporary = `${this.path}.${randomUUID()}.tmp`;
		await mkdir(dirname(this.path), { recursive: true });
		try {
			await writeFile(temporary, JSON.stringify({ v: 1, deviceId }), {
				encoding: "utf8",
				mode: 0o600,
				flag: "wx",
			});
			await rename(temporary, this.path);
		} finally {
			await rm(temporary, { force: true }).catch(() => undefined);
		}
		return deviceId;
	}
}
