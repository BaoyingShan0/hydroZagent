import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { normalizeToolArgs } from "../src/core/tools/normalize-args.ts";

const readSchema = Type.Object({
	path: Type.String(),
	offset: Type.Optional(Type.Number()),
});

const editSchema = Type.Object({
	path: Type.String(),
	edits: Type.Array(Type.Object({ oldText: Type.String(), newText: Type.String() })),
});

describe("normalizeToolArgs", () => {
	it("renames file_path to path when path is a schema property", () => {
		const result = normalizeToolArgs({ file_path: "a.txt", offset: 1 }, readSchema);
		expect(result).toEqual({ path: "a.txt", offset: 1 });
	});

	it("renames old_string/new_string inside edits[] items", () => {
		const result = normalizeToolArgs({ path: "a.txt", edits: [{ old_string: "x", new_string: "y" }] }, editSchema);
		expect(result).toEqual({ path: "a.txt", edits: [{ oldText: "x", newText: "y" }] });
	});

	it("returns the same reference when nothing changes", () => {
		const input = { path: "a.txt", offset: 2 };
		expect(normalizeToolArgs(input, readSchema)).toBe(input);
	});

	it("never clobbers an explicitly supplied canonical key", () => {
		const input = { path: "canonical.txt", file_path: "alias.txt" };
		const result = normalizeToolArgs(input, readSchema) as Record<string, unknown>;
		expect(result.path).toBe("canonical.txt");
	});

	it("leaves a foreign key untouched when the canonical target is not in the schema", () => {
		// `old_string` at top level: schema has no top-level `oldText`, so it is left for
		// the tool's own prepareArguments to handle.
		const input = { path: "a.txt", old_string: "x" };
		expect(normalizeToolArgs(input, editSchema)).toBe(input);
	});

	it("does not touch a tool that legitimately declares file_path", () => {
		const nativeFilePathSchema = Type.Object({ file_path: Type.String() });
		const input = { file_path: "a.txt" };
		expect(normalizeToolArgs(input, nativeFilePathSchema)).toBe(input);
	});

	it("passes non-object input through unchanged", () => {
		expect(normalizeToolArgs(null, readSchema)).toBe(null);
		expect(normalizeToolArgs("garbage", readSchema)).toBe("garbage");
	});

	it("leaves objects untouched when no schema is provided", () => {
		const input = { file_path: "a.txt" };
		expect(normalizeToolArgs(input, undefined)).toBe(input);
	});
});
