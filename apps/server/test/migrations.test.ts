import { describe, expect, it } from "vitest";
import { loadMigrations } from "../src/db/migrations.js";

describe("P0 migration source", () => {
	it("contains every accepted Spec table and the two link cascades", async () => {
		const migrations = await loadMigrations();
		expect(migrations.map((migration) => migration.version)).toEqual(["0001_p0_schema.sql"]);

		const source = migrations[0]?.upSql ?? "";
		for (const table of [
			"users",
			"auth_sessions",
			"consents",
			"password_resets",
			"model_proxy_calls",
			"usage_records",
			"turn_model_call_links",
			"admin_audit",
		]) {
			expect(source).toContain(`CREATE TABLE ${table}`);
		}
		expect(source.match(/ON DELETE CASCADE/gu)).toHaveLength(2);
		expect(source).toContain("invalidated_at timestamptz");
		expect(source).toContain("issued_by_audit_id uuid NOT NULL");
		expect(source).toContain("'in_progress'");
		expect(source).toContain("usage_records_p0_group_empty");
	});
});
