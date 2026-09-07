import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { convergenceHash } from "../../src/convergence/canonicalizer.ts";

it("keeps synchronous convergence fingerprints byte-identical to SHA-256 across runtimes", () => {
	for (const value of ["", "abc", "水文模型 😀", "\ud800", "x".repeat(65537)]) {
		expect(convergenceHash(value)).toBe(`sha256:${createHash("sha256").update(value).digest("hex")}`);
	}
});
