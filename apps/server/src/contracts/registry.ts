import type { FastifyInstance } from "fastify";
import { HCS_SCHEMA_JSON } from "./generated.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadContractSchema(): { document: Record<string, unknown>; id: string; definitions: Record<string, unknown> } {
	const parsedSchema: unknown = JSON.parse(HCS_SCHEMA_JSON);
	if (!isRecord(parsedSchema) || typeof parsedSchema.$id !== "string" || !isRecord(parsedSchema.$defs)) {
		throw new Error("Generated HCS schema document is invalid");
	}
	return { document: parsedSchema, id: parsedSchema.$id, definitions: parsedSchema.$defs };
}
const contractSchema = loadContractSchema();
const definitionNames = new Set(Object.keys(contractSchema.definitions));

export function registerContractSchema(app: FastifyInstance): void {
	const fastifySchema = { ...contractSchema.document };
	delete fastifySchema.$schema;
	app.addSchema(fastifySchema);
}

export function contractSchemaRef(name: string): { $ref: string } {
	if (!definitionNames.has(name)) throw new Error(`Unknown HCS contract schema ${name}`);
	return { $ref: `${contractSchema.id}#/$defs/${name}` };
}
