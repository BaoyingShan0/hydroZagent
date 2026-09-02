import { createDatabasePool } from "./pool.js";
import { runMigrations, type MigrationDirection } from "./migrations.js";

function readDirection(value: string | undefined): MigrationDirection {
	if (value === "up" || value === "down") return value;
	throw new Error("Usage: npm run migrate -- <up|down>");
}

const direction = readDirection(process.argv[2]);
if (direction === "down" && process.env.HCS_ENV !== "test") {
	throw new Error("Down migrations are restricted to HCS_ENV=test; production uses forward fixes");
}
const databaseUrl = process.env.HCS_DATABASE_URL;
if (!databaseUrl) throw new Error("HCS_DATABASE_URL is required for migrations");

const pool = createDatabasePool(databaseUrl);
try {
	const changed = await runMigrations(pool, direction);
	process.stdout.write(`${direction} migrations: ${changed.length === 0 ? "no changes" : changed.join(", ")}\n`);
} finally {
	await pool.end();
}
