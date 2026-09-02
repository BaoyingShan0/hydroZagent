import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type UsageFieldName = "user_input" | "assistant_final";

type Envelope = {
	v: 1;
	key_id: string;
	nonce: string;
	ciphertext: string;
	tag: string;
};

type UsageKeyringOptions = {
	currentKeyId: string;
	keys: ReadonlyMap<string, Uint8Array>;
	fingerprintKey: Uint8Array;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactBase64(value: unknown, expectedBytes?: number): Buffer {
	if (typeof value !== "string" || (value.length === 0 && expectedBytes !== undefined)) {
		throw new Error("Invalid encrypted usage envelope");
	}
	const decoded = Buffer.from(value, "base64");
	if (decoded.toString("base64") !== value || (expectedBytes !== undefined && decoded.byteLength !== expectedBytes)) {
		throw new Error("Invalid encrypted usage envelope");
	}
	return decoded;
}

function parseEnvelope(serialized: Uint8Array): Envelope {
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder().decode(serialized));
	} catch {
		throw new Error("Invalid encrypted usage envelope");
	}
	if (
		!isRecord(value) ||
		Object.keys(value).length !== 5 ||
		value.v !== 1 ||
		typeof value.key_id !== "string" ||
		typeof value.nonce !== "string" ||
		typeof value.ciphertext !== "string" ||
		typeof value.tag !== "string"
	) {
		throw new Error("Invalid encrypted usage envelope");
	}
	exactBase64(value.nonce, 12);
	exactBase64(value.ciphertext);
	exactBase64(value.tag, 16);
	return {
		v: 1,
		key_id: value.key_id,
		nonce: value.nonce,
		ciphertext: value.ciphertext,
		tag: value.tag,
	};
}

function aad(eventId: string, userId: string, fieldName: UsageFieldName): Buffer {
	return Buffer.from(JSON.stringify([1, "usage_record", eventId, userId, fieldName]), "utf8");
}

export class UsageKeyring {
	readonly currentKeyId: string;
	private readonly keys: ReadonlyMap<string, Uint8Array>;
	private readonly fingerprintKey: Uint8Array;

	constructor(options: UsageKeyringOptions) {
		const current = options.keys.get(options.currentKeyId);
		if (!options.currentKeyId || !current || current.byteLength !== 32 || options.fingerprintKey.byteLength !== 32) {
			throw new Error("Invalid usage encryption keyring");
		}
		for (const [keyId, key] of options.keys) {
			if (!keyId || key.byteLength !== 32) throw new Error("Invalid usage encryption keyring");
		}
		this.currentKeyId = options.currentKeyId;
		this.keys = options.keys;
		this.fingerprintKey = options.fingerprintKey;
	}

	encrypt(plaintext: string, eventId: string, userId: string, fieldName: UsageFieldName): Uint8Array {
		const key = this.keys.get(this.currentKeyId);
		if (!key) throw new Error("Current usage encryption key is unavailable");
		const nonce = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", key, nonce);
		cipher.setAAD(aad(eventId, userId, fieldName));
		const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
		const envelope: Envelope = {
			v: 1,
			key_id: this.currentKeyId,
			nonce: nonce.toString("base64"),
			ciphertext: ciphertext.toString("base64"),
			tag: cipher.getAuthTag().toString("base64"),
		};
		return Buffer.from(JSON.stringify(envelope), "utf8");
	}

	decrypt(serialized: Uint8Array, eventId: string, userId: string, fieldName: UsageFieldName): string {
		const envelope = parseEnvelope(serialized);
		const key = this.keys.get(envelope.key_id);
		if (!key) throw new Error("Usage encryption key is unavailable");
		const decipher = createDecipheriv("aes-256-gcm", key, exactBase64(envelope.nonce, 12));
		decipher.setAAD(aad(eventId, userId, fieldName));
		decipher.setAuthTag(exactBase64(envelope.tag, 16));
		return Buffer.concat([decipher.update(exactBase64(envelope.ciphertext)), decipher.final()]).toString("utf8");
	}

	reencrypt(serialized: Uint8Array, eventId: string, userId: string, fieldName: UsageFieldName): Uint8Array | null {
		const envelope = parseEnvelope(serialized);
		if (envelope.key_id === this.currentKeyId) return null;
		return this.encrypt(this.decrypt(serialized, eventId, userId, fieldName), eventId, userId, fieldName);
	}

	fingerprint(canonicalPayload: string): string {
		return createHmac("sha256", this.fingerprintKey).update(canonicalPayload, "utf8").digest("hex");
	}

	fingerprintMatches(canonicalPayload: string, expectedHex: string): boolean {
		const actual = Buffer.from(this.fingerprint(canonicalPayload), "hex");
		const expected = Buffer.from(expectedHex, "hex");
		return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
	}
}

export function parseUsageKeyring(source: string, fingerprintKeyBase64: string): UsageKeyring {
	const parsed: unknown = JSON.parse(source);
	if (!isRecord(parsed) || typeof parsed.current_key_id !== "string" || !isRecord(parsed.keys)) {
		throw new Error("Invalid usage keyring configuration");
	}
	const keys = new Map<string, Uint8Array>();
	for (const [keyId, encoded] of Object.entries(parsed.keys)) keys.set(keyId, exactBase64(encoded, 32));
	return new UsageKeyring({
		currentKeyId: parsed.current_key_id,
		keys,
		fingerprintKey: exactBase64(fingerprintKeyBase64, 32),
	});
}
