import { generateContracts, verifyContractFixtures } from "./hcs-contract-core.mjs";

const drifted = generateContracts({ check: true });
const fixtureFailures = verifyContractFixtures();

if (drifted.length > 0) {
	for (const path of drifted) process.stderr.write(`Generated contract drift: ${path}\n`);
}
if (fixtureFailures.length > 0) {
	for (const failure of fixtureFailures) process.stderr.write(`Contract fixture failure: ${failure}\n`);
}
if (drifted.length > 0 || fixtureFailures.length > 0) {
	process.exitCode = 1;
} else {
	process.stdout.write("HCS contract drift, references, and fixtures: PASS\n");
}
