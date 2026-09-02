import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HCS_CONTRACT_SHA256, HCS_CONTRACT_VERSION, HCS_SCHEMA_JSON } from "../src/contracts/generated.js";

describe("generated HCS contract", () => {
	it("contains the canonical schema content hash", () => {
		const schema = JSON.parse(HCS_SCHEMA_JSON);
		const hash = createHash("sha256").update(`${JSON.stringify(schema)}\n`).digest("hex");

		expect(HCS_CONTRACT_VERSION).toBe("1");
		expect(hash).toBe(HCS_CONTRACT_SHA256);
	});
});
