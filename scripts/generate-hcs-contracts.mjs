import { generateContracts } from "./hcs-contract-core.mjs";

const check = process.argv.includes("--check");
const drifted = generateContracts({ check });

if (drifted.length > 0) {
	process.stderr.write(`Generated HCS contracts are stale:\n${drifted.map((path) => `  ${path}`).join("\n")}\n`);
	process.exitCode = 1;
} else if (check) {
	process.stdout.write("Generated HCS contracts are current.\n");
} else {
	process.stdout.write("Generated HCS contracts updated.\n");
}
