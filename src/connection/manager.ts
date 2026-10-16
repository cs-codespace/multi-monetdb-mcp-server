import { Connection } from "monetdb";
import { getConnection } from "../config/loader.js";
import { normalizeResult } from "../sql/result.js";
import type {
  DbConnection,
  DynamicConnectionInput,
  MonetDbConnectionConfig,
  ResolvedConnection,
} from "../types.js";

export const DYNAMIC_LABEL = "__dynamic__";

interface ConnectionEntry {
  conn: Connection;
  hash: string;
  connected: boolean;
}

const connections = new Map<string, ConnectionEntry>();
let dynamicSession: DbConnection | null = null;

function dynamicInputToConnection(input: DynamicConnectionInput): DbConnection {
  return {
    label: DYNAMIC_LABEL,
    host: input.host,
    port: input.port,
    user: input.user,
    password: input.password,
    database: input.database,
    url: input.url,
    enabled: true,
    readOnly: input.readOnly,
    timeout: input.timeout,
    replySize: input.replySize,
  };
}

function connHash(c: DbConnection): string {
  return JSON.stringify({
    h: c.host,
    p: c.port,
    u: c.user,
    pw: c.password,
    d: c.database,
    url: c.url,
    t: c.timeout,
    rs: c.replySize,
  });
}

function buildConnectionConfig(
  conn: DbConnection
): string | MonetDbConnectionConfig {
  if (conn.url) return conn.url;

  return {
    host: conn.host,
    port: conn.port,
    username: conn.user,
    password: conn.password,
    database: conn.database!,
    timeout: conn.timeout,
    replySize: conn.replySize,
    autoCommit: false,
  };
}

function markDisconnected(label: string): void {
  const entry = connections.get(label);
  if (entry) entry.connected = false;
}

/**
 * The monetdb driver emits "error" on MapiConnection for socket timeouts but
 * does not reject connect() — attach a handler so the MCP process does not crash.
 */
function attachMapiErrorHandler(conn: DbConnection, mdbConn: Connection): void {
  mdbConn.mapi.on("error", (err: Error) => {
    console.error(`MonetDB [${conn.label}]: ${err.message}`);
    markDisconnected(conn.label);
    mdbConn.destroy();
  });
}

async function connectSafely(
  conn: DbConnection,
  mdbConn: Connection
): Promise<void> {
  const timeoutMs = conn.timeout ?? 10_000;
  attachMapiErrorHandler(conn, mdbConn);

  const connectFailed = new Promise<never>((_, reject) => {
    mdbConn.mapi.once("error", reject);
  });

  const watchdog = new Promise<never>((_, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            `Connection timeout after ${timeoutMs}ms (${describeConnection(conn)})`
          )
        ),
      timeoutMs + 2_000
    );
  });

  try {
    await Promise.race([mdbConn.connect(), connectFailed, watchdog]);
  } catch (e) {
    await mdbConn.close().catch(() => {});
    throw e;
  }
}

export function hasDynamicConnection(): boolean {
  return dynamicSession !== null;
}

export function getDynamicSession(): DbConnection | null {
  return dynamicSession;
}

export function describeConnection(c: DbConnection): string {
  return c.url
    ? "(MAPI connection string)"
    : `${c.user}@${c.host}:${c.port}/${c.database}`;
}

export async function getOrCreateConnection(
  conn: DbConnection
): Promise<Connection> {
  const hash = connHash(conn);
  const existing = connections.get(conn.label);

  if (existing && existing.hash === hash && existing.connected) {
    return existing.conn;
  }

  if (existing) {
    await existing.conn.close().catch(() => {});
  }

  const mdbConn = new Connection(buildConnectionConfig(conn));
  await connectSafely(conn, mdbConn);

  connections.set(conn.label, { conn: mdbConn, hash, connected: true });
  return mdbConn;
}

export async function clearDynamicConnection(): Promise<void> {
  const existing = connections.get(DYNAMIC_LABEL);
  if (existing) {
    await existing.conn.close().catch(() => {});
    connections.delete(DYNAMIC_LABEL);
  }
  dynamicSession = null;
}

export async function setDynamicConnection(
  input: DynamicConnectionInput
): Promise<{ latencyMs: number; version: string }> {
  const connConfig = dynamicInputToConnection(input);
  await clearDynamicConnection();

  const start = Date.now();
  const conn = await getOrCreateConnection(connConfig);
  const res = await conn.execute(`
    SELECT value AS version
    FROM sys.environment
    WHERE name = 'monet_version'
  `);
  const latencyMs = Date.now() - start;
  const version = String(normalizeResult(res).rows[0]?.version ?? "unknown");

  dynamicSession = connConfig;
  return { latencyMs, version };
}

export async function resolveConnection(
  database?: string
): Promise<ResolvedConnection> {
  if (dynamicSession) {
    return { config: dynamicSession, source: "dynamic" };
  }

  if (database) {
    return { config: await getConnection(database), source: "config" };
  }

  throw new Error(
    "No active connection. See mdb_list_databases for connection instructions."
  );
}

export async function drainAllConnections(): Promise<void> {
  const tasks = [...connections.values()].map((e) =>
    e.conn.close().catch(() => {})
  );
  connections.clear();
  dynamicSession = null;
  await Promise.all(tasks);
}
