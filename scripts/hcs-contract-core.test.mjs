import assert from "node:assert/strict";
import { test } from "node:test";
import {
	contractHash,
	loadContractSource,
	renderGeneratedContract,
	validateFixture,
	verifyContractFixtures,
} from "./hcs-contract-core.mjs";

test("accepted and rejected HCS fixtures match the canonical schema", () => {
	assert.deepEqual(verifyContractFixtures(), []);
});

test("contract generation is deterministic and contains its source hash", () => {
	const { schema } = loadContractSource();
	const first = renderGeneratedContract(schema);
	const second = renderGeneratedContract(structuredClone(schema));
	assert.equal(first, second);
	assert.match(first, new RegExp(contractHash(schema), "u"));
});

test("unknown fixture schemas fail closed", () => {
	const { schema } = loadContractSource();
	assert.deepEqual(validateFixture(schema, "MissingSchema", {}), ["$: unknown schema MissingSchema"]);
});
