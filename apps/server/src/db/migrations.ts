import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

const MIGRATION_LOCK_ID = 782_340_017;
const UP_MARKER = "-- migrate:up";
const DOWN_MARKER = "-- migrate:down";

export type MigrationDirection = "up" | "down";

export type Migration = {
	version: string;
	upSql: string;
	downSql: string;
};

function defaultMigrationDirectory(): string {
	return fileURLToPath(new URL("../../migrations/", import.meta.url));
}

function parseMigration(version: string, source: string): Migration {
	const upIndex = source.indexOf(UP_MARKER);
	const downIndex = source.indexOf(DOWN_MARKER);
	if (upIndex === -1 || downIndex === -1 || downIndex <= upIndex) {
		throw new Error(`Migration ${version} must contain ordered ${UP_MARKER} and ${DOWN_MARKER} markers`);
	}
	const upSql = source.slice(upIndex + UP_MARKER.length, downIndex).trim();
	const downSql = source.slice(downIndex + DOWN_MARKER.length).trim();
	if (upSql.length === 0 || downSql.length === 0) throw new Error(`Migration ${version} contains an empty direction`);
	return { version, upSql, downSql };
}

export async function loadMigrations(directory = defaultMigrationDirectory()): Promise<Migration[]> {
	const names = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name)).sort();
	const migrations = await Promise.all(
		names.map(async (name) => parseMigration(name, await readFile(join(directory, name), "utf8"))),
	);
	const versions = new Set(migrations.map((migration) => migration.version));
	if (versions.size !== migrations.length) throw new Error("Duplicate migration version detected");
	return migrations;
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
	await client.query(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)
	`);
}

async function applyUp(client: PoolClient, migrations: Migration[]): Promise<string[]> {
	const appliedResult = await client.query<{ version: string }>("SELECT version FROM schema_migrations");
	const applied = new Set(appliedResult.rows.map((row) => row.version));
	const changed = [];
	for (const migration of migrations) {
		if (applied.has(migration.version)) continue;
		await client.query("BEGIN");
		try {
			await client.query(migration.upSql);
			await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [migration.version]);
			await client.query("COMMIT");
			changed.push(migration.version);
		} catch (error: unknown) {
			await client.query("ROLLBACK");
			throw error;
		}
	}
	return changed;
}

async function applyDown(client: PoolClient, migrations: Migration[], steps: number): Promise<string[]> {
	const appliedResult = await client.query<{ version: string }>(
		"SELECT version FROM schema_migrations ORDER BY applied_at DESC, version DESC",
	);
	const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));
	const changed = [];
	for (const row of appliedResult.rows.slice(0, steps)) {
		const migration = byVersion.get(row.version);
		if (!migration) throw new Error(`Applied migration ${row.version} has no local file`);
		await client.query("BEGIN");
		try {
			await client.query(migration.downSql);
			await client.query("DELETE FROM schema_migrations WHERE version = $1", [migration.version]);
			await client.query("COMMIT");
			changed.push(migration.version);
		} catch (error: unknown) {
			await client.query("ROLLBACK");
			throw error;
		}
	}
	return changed;
}

/** Applies migrations under a PostgreSQL advisory lock so only one deployment mutates the schema. */
export async function runMigrations(
	pool: Pool,
	direction: MigrationDirection,
	options: { directory?: string; steps?: number } = {},
): Promise<string[]> {
	const migrations = await loadMigrations(options.directory);
	const client = await pool.connect();
	try {
		await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
		await ensureMigrationTable(client);
		if (direction === "up") return await applyUp(client, migrations);
		return await applyDown(client, migrations, options.steps ?? 1);
	} finally {
		await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => undefined);
		client.release();
	}
}
