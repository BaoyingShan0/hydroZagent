/**
 * Schema-aware tool-argument normalization.
 *
 * Different agents/models emit the same tool call with different parameter
 * vocabularies. Claude Code's edit/write tools use `file_path`, `old_string`
 * and `new_string`; pi's canonical schema uses `path`, `oldText` and `newText`.
 * When a model sends the foreign spelling, schema validation rejects the call and
 * the model has to retry — wasting a full round-trip (~20% of observed tool errors).
 *
 * This runs before schema validation (via each tool's `prepareArguments`) and
 * renames known aliases to their canonical key. It is *schema-aware*: an alias is
 * only rewritten when the canonical key is a real property of the tool's schema and
 * the alias is not — so a tool that legitimately declares `file_path` is never
 * touched. Identity is preserved when nothing changes, keeping the runtime's
 * "arguments unchanged" fast path intact.
 */

/** Foreign key spelling → pi canonical key. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
	file_path: "path",
	filepath: "path",
	filePath: "path",
	old_string: "oldText",
	oldString: "oldText",
	old_str: "oldText",
	new_string: "newText",
	newString: "newText",
	new_str: "newText",
};

/** Structural view of a TypeBox object/array schema (decoupled from the concrete type export). */
interface SchemaLike {
	properties?: Record<string, SchemaLike | undefined>;
	items?: SchemaLike;
}

function asSchemaLike(schema: unknown): SchemaLike | undefined {
	return schema && typeof schema === "object" ? (schema as SchemaLike) : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize raw tool-call arguments against the tool's parameter schema.
 * Returns the same reference when no change is needed.
 */
export function normalizeToolArgs(args: unknown, schema: unknown): unknown {
	return normalizeValue(args, asSchemaLike(schema));
}

function normalizeValue(value: unknown, schema: SchemaLike | undefined): unknown {
	if (Array.isArray(value)) {
		return normalizeArray(value, schema?.items);
	}
	if (isPlainObject(value)) {
		return normalizeObject(value, schema);
	}
	return value;
}

function normalizeArray(value: unknown[], itemSchema: SchemaLike | undefined): unknown[] {
	if (!itemSchema) return value;
	let changed = false;
	const next = value.map((item) => {
		const normalized = normalizeValue(item, itemSchema);
		if (normalized !== item) changed = true;
		return normalized;
	});
	return changed ? next : value;
}

function normalizeObject(value: Record<string, unknown>, schema: SchemaLike | undefined): Record<string, unknown> {
	const properties = schema?.properties;
	// Without a schema we cannot tell an alias from a real key; leave the object untouched.
	if (!properties) return value;

	let result = value;
	const ensureCopy = (): Record<string, unknown> => {
		if (result === value) result = { ...value };
		return result;
	};

	// 1. Rename foreign aliases to canonical keys when it is safe and helpful.
	for (const key of Object.keys(value)) {
		const canonical = KEY_ALIASES[key];
		if (!canonical || canonical === key) continue;
		// Only rewrite when the canonical name is a real schema property and the alias is not,
		// and the canonical key is not already supplied (never clobber an explicit value).
		if (!(canonical in properties) || key in properties || canonical in value) continue;
		const copy = ensureCopy();
		copy[canonical] = copy[key];
		delete copy[key];
	}

	// 2. Recurse into nested object/array properties (e.g. edits[].old_string).
	for (const key of Object.keys(result)) {
		const propSchema = properties[key];
		if (!propSchema) continue;
		const child = result[key];
		const normalizedChild = normalizeValue(child, propSchema);
		if (normalizedChild !== child) {
			ensureCopy()[key] = normalizedChild;
		}
	}

	return result;
}
