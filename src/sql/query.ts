import type { Connection } from "monetdb";
import {
  getOrCreateConnection,
  resolveConnection,
} from "../connection/manager.js";
import { normalizeResult } from "./result.js";
import type { DbConnection, NormalizedResult } from "../types.js";

export async function withConnection<T>(
  database: string | undefined,
  fn: (conn: Connection, config: DbConnection) => Promise<T>
): Promise<T> {
  const { config } = await resolveConnection(database);
  const conn = await getOrCreateConnection(config);
  return fn(conn, config);
}

export async function executeQuery(
  conn: Connection,
  query: string,
  readOnly: boolean
): Promise<NormalizedResult> {
  // MonetDB with autoCommit:false is already in a transaction — do not START TRANSACTION
  try {
    const result = await conn.execute(query);
    if (readOnly) {
      await conn.execute("ROLLBACK");
    } else {
      await conn.execute("COMMIT");
    }
    return normalizeResult(result);
  } catch (e) {
    await conn.execute("ROLLBACK").catch(() => {});
    throw e;
  }
}
