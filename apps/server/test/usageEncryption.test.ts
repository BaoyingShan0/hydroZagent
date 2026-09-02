import { describe, expect, it } from "vitest";
import type { UsageIngestRequest } from "../src/contracts/generated.js";
import { UsageKeyring } from "../src/usage/encryption.js";
import { UsageService } from "../src/usage/usageService.js";
import { InMemoryUsageRepository } from "./support/inMemoryUsageRepository.js";

const EVENT_ID = "00000000-0000-4000-8000-000000000010";
const USER_ID = "00000000-0000-4000-8000-000000000011";

function key(value: number): Uint8Array {
	return new Uint8Array(32).fill(value);
}

function keyring(currentKeyId = "key-1", includeOld = true): UsageKeyring {
	const keys = new Map<string, Uint8Array>([[currentKeyId, key(currentKeyId === "key-1" ? 1 : 2)]]);
	if (includeOld && currentKeyId !== "key-1") keys.set("key-1", key(1));
	return new UsageKeyring({ currentKeyId, keys, fingerprintKey: key(9) });
}

function request(overrides: Partial<UsageIngestRequest> = {}): UsageIngestRequest {
	return {
		event_id: EVENT_ID,
		session_id: "00000000-0000-4000-8000-000000000012",
		turn_id: "00000000-0000-4000-8000-000000000013",
		client_created_at: "2026-09-01T00:00:00.000Z",
		task_category: "Coding",
		model: "managed-coder",
		client_version: "0.1.0-hydro",
		device_id: "device-1",
		turn_status: "completed",
		user_input: "database password is not logged",
		assistant_final: "completed safely",
		anonymous: false,
		model_call_ids: [],
		...overrides,
	};
}

describe("usage AES-256-GCM envelope", () => {
	it("round-trips without storing plaintext and supports empty content", () => {
		const crypto = keyring();
		const encrypted = crypto.encrypt("database password is not logged", EVENT_ID, USER_ID, "user_input");
		expect(new TextDecoder().decode(encrypted)).not.toContain("database password");
		expect(crypto.decrypt(encrypted, EVENT_ID, USER_ID, "user_input")).toBe("database password is not logged");
		const empty = crypto.encrypt("", EVENT_ID, USER_ID, "assistant_final");
		expect(crypto.decrypt(empty, EVENT_ID, USER_ID, "assistant_final")).toBe("");
	});

	it("rejects tampering and cross-record, cross-user, or cross-field substitution", () => {
		const crypto = keyring();
		const encrypted = crypto.encrypt("bound plaintext", EVENT_ID, USER_ID, "user_input");
		const envelope = JSON.parse(new TextDecoder().decode(encrypted)) as Record<string, unknown>;
		const ciphertext = Buffer.from(String(envelope.ciphertext), "base64");
		ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
		envelope.ciphertext = ciphertext.toString("base64");
		const tampered = Buffer.from(JSON.stringify(envelope));
		expect(() => crypto.decrypt(tampered, EVENT_ID, USER_ID, "user_input")).toThrow();
		expect(() => crypto.decrypt(encrypted, "00000000-0000-4000-8000-000000000099", USER_ID, "user_input")).toThrow();
		expect(() => crypto.decrypt(encrypted, EVENT_ID, "00000000-0000-4000-8000-000000000099", "user_input")).toThrow();
		expect(() => crypto.decrypt(encrypted, EVENT_ID, USER_ID, "assistant_final")).toThrow();
	});

	it("reads old keys, prepares lazy rotation, and fails closed if the old key is missing", () => {
		const encrypted = keyring().encrypt("rotate me", EVENT_ID, USER_ID, "user_input");
		const rotated = keyring("key-2").reencrypt(encrypted, EVENT_ID, USER_ID, "user_input");
		expect(rotated).not.toBeNull();
		if (!rotated) throw new Error("Expected a rotated envelope");
		expect(keyring("key-2").decrypt(rotated, EVENT_ID, USER_ID, "user_input")).toBe("rotate me");
		expect(() => keyring("key-2", false).decrypt(encrypted, EVENT_ID, USER_ID, "user_input")).toThrow(
			"Usage encryption key is unavailable",
		);
	});
});

describe("UsageService", () => {
	it("keeps the first event immutable and marks identical and conflicting retries as deduplicated", async () => {
		const repository = new InMemoryUsageRepository();
		const service = new UsageService({ repository, keyring: keyring(), maximumPayloadBytes: 64 * 1024 });
		expect(await service.ingest(request(), USER_ID, new Date())).toEqual({ accepted: true, deduplicated: false });
		expect(await service.ingest(request(), USER_ID, new Date())).toEqual({ accepted: true, deduplicated: true });
		expect(await service.ingest(request({ user_input: "changed retry" }), USER_ID, new Date())).toEqual({
			accepted: true,
			deduplicated: true,
		});
		expect(repository.records).toHaveLength(1);
		expect(repository.conflicts).toEqual([EVENT_ID]);
		const stored = repository.records.get(EVENT_ID);
		if (!stored) throw new Error("Expected stored usage");
		expect(service.decrypt(stored.userInput, EVENT_ID, USER_ID, "user_input")).toBe("database password is not logged");
		expect(stored.request).toMatchObject({ anonymous: false });
	});

	it("rejects payloads above the configured byte limit before repository I/O", async () => {
		const repository = new InMemoryUsageRepository();
		const service = new UsageService({ repository, keyring: keyring(), maximumPayloadBytes: 100 });
		await expect(service.ingest(request(), USER_ID, new Date())).rejects.toMatchObject({ code: "payload_too_large" });
		expect(repository.records).toHaveLength(0);
	});
});
