import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

async function source(path) {
	return readFile(resolve(root, path), "utf8");
}

const compose = await source("deploy/hcs/compose.yml");
const dockerfile = await source("apps/server/Dockerfile");
const backup = await source("deploy/hcs/scripts/backup.sh");
const restore = await source("deploy/hcs/scripts/restore-smoke.sh");
const verifier = await source("deploy/hcs/scripts/verify-deployment.sh");
const sudoers = (await source("deploy/hcs/sudoers/hydro-hcs")).trim();

const failures = [];
function requireText(haystack, needle, reason) {
	if (!haystack.includes(needle)) failures.push(reason);
}

requireText(compose, "condition: service_completed_successfully", "HCS must wait for a successful migration job");
requireText(compose, "internal: true", "PostgreSQL network must be internal");
requireText(compose, 'read_only: true', "HCS and one-shot containers must use a read-only root filesystem");
requireText(compose, 'no-new-privileges:true', "Containers must disable privilege escalation");
requireText(compose, "HCS_POSTGRES_IMAGE:?set a reviewed digest-pinned", "PostgreSQL image must be an explicit reviewed input");
const postgresBlock = compose.slice(compose.indexOf("  postgres:"), compose.indexOf("  migration:"));
if (/\n\s+ports:/u.test(postgresBlock)) failures.push("PostgreSQL must not publish a host port");
requireText(dockerfile, "USER node", "HCS runtime must be non-root");
requireText(dockerfile, "npm ci --ignore-scripts", "HCS container install must keep lifecycle scripts disabled");
requireText(backup, "pg_dump", "Backup must originate from pg_dump");
requireText(backup, "HCS_AGE_IMAGE", "Backup must use the reviewed age image");
requireText(backup, ".sql.age.partial", "Backup must use an atomic encrypted partial file");
if (/\.sql(?:\s|")/u.test(backup)) failures.push("Backup script must not create a plaintext SQL file");
requireText(restore, "cleanupCli.js", "Restore must run retention cleanup before verification");
requireText(restore, "restoreVerifyCli.js", "Restore must run integrity verification before handoff");
requireText(verifier, "@sha256:", "Deployment gate must enforce digest-pinned images");
if (sudoers !== "%hydro-admin ALL=(root) /usr/local/sbin/hydro-hcs-admin") {
	failures.push("sudoers must expose only the fixed one-shot administrator wrapper");
}

if (failures.length > 0) {
	for (const failure of failures) process.stderr.write(`HCS deploy check failed: ${failure}\n`);
	process.exitCode = 1;
} else {
	process.stdout.write("HCS deployment static gate: PASS\n");
}
