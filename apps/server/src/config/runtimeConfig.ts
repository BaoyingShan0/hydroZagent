import { Type, type Static } from "typebox";
import { Check, Errors } from "typebox/value";
import { readFileSync } from "node:fs";

const RuntimeConfigSchema = Type.Object(
	{
		environment: Type.Union([Type.Literal("development"), Type.Literal("test"), Type.Literal("production")]),
		host: Type.String({ minLength: 1 }),
		port: Type.Integer({ minimum: 1, maximum: 65_535 }),
		databaseUrl: Type.Optional(Type.String({ minLength: 1 })),
	},
	{ additionalProperties: false },
);

export type RuntimeConfig = Static<typeof RuntimeConfigSchema>;
export type AppRuntimeConfig = RuntimeConfig & { https?: { cert: string; key: string } };

function parseEnvironment(value: string | undefined): RuntimeConfig["environment"] {
	if (value === undefined || value === "development") return "development";
	if (value === "test" || value === "production") return value;
	throw new Error(`HCS_ENV must be development, test, or production; received ${value}`);
}

/** Parses only process bootstrap settings; production security readiness is evaluated separately. */
export function readRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): AppRuntimeConfig {
	const port = environment.HCS_PORT === undefined ? 8787 : Number(environment.HCS_PORT);
	const candidate = {
		environment: parseEnvironment(environment.HCS_ENV),
		host: environment.HCS_HOST ?? "127.0.0.1",
		port,
		...(environment.HCS_DATABASE_URL === undefined ? {} : { databaseUrl: environment.HCS_DATABASE_URL }),
	};
	if (!Check(RuntimeConfigSchema, candidate)) {
		const details = Errors(RuntimeConfigSchema, candidate)
			.map((error) => `${error.instancePath || "$"}: ${error.message}`)
			.join("; ");
		throw new Error(`Invalid HCS runtime configuration: ${details}`);
	}
	if (candidate.environment !== "production") return candidate;
	const certificatePath = environment.HCS_TLS_CERT_PATH;
	const privateKeyPath = environment.HCS_TLS_KEY_PATH;
	if (!certificatePath || !privateKeyPath) throw new Error("Production HCS requires TLS certificate and key paths");
	try {
		return {
			...candidate,
			https: {
				cert: readFileSync(certificatePath, "utf8"),
				key: readFileSync(privateKeyPath, "utf8"),
			},
		};
	} catch {
		throw new Error("Production HCS TLS material is unavailable");
	}
}
