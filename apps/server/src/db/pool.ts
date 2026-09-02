import { Pool } from "pg";

/** Creates the shared HCS pool without logging or otherwise exposing the connection URL. */
export function createDatabasePool(connectionString: string): Pool {
	return new Pool({ connectionString, max: 10 });
}
