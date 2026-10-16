import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DynamicConnectionInputSchema } from "../config/schema.js";
import { LABEL_FILTER, NO_DYNAMIC } from "../config/cli.js";
import { loadConfig } from "../config/loader.js";
import {
  clearDynamicConnection,
  describeConnection,
  getDynamicSession,
  hasDynamicConnection,
  resolveConnection,
  setDynamicConnection,
} from "../connection/manager.js";
import {
  buildConnectionGuidance,
  errorResult,
  handleToolError,
} from "../guidance/messages.js";
import { isReadOnlyQuery, isSingleStatement } from "../sql/safety.js";
import { executeQuery, withConnection } from "../sql/query.js";
import { normalizeResult } from "../sql/result.js";
import { optionalDatabaseParam } from "./params.js";

export function registerTools(server: McpServer): void {
  registerConnectTools(server);
  registerCatalogTools(server);
  registerQueryTools(server);
}

function registerConnectTools(server: McpServer): void {
  server.tool(
    "mdb_connect",
    "Connect to MonetDB at runtime with user-provided credentials (NOT from config.json). Always call this first when the user gives you host/user/password/database directly. Runs a health check; on success all other mdb_* tools use this session — omit the database parameter on subsequent calls. Replaces any previous dynamic session.",
    {
      host: z.string().optional().describe("MonetDB server hostname"),
      port: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("MAPI port (default: 50000)"),
      user: z.string().optional().describe("Username"),
      password: z.string().optional().describe("Password"),
      database: z.string().optional().describe("Database name"),
      url: z
        .string()
        .optional()
        .describe("Full MAPI URL, e.g. mapi:monetdb://user:pass@host:50000/db"),
      readOnly: z
        .boolean()
        .optional()
        .describe("Block write queries when true (default: true)"),
      timeout: z
        .coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("Connection timeout in ms (default: 10000)"),
    },
    async (input) => {
      if (NO_DYNAMIC) {
        const hint = LABEL_FILTER
          ? `Use database="${LABEL_FILTER}" with config-based tools instead.`
          : "This server is restricted to config-file connections only.";
        return {
          content: [
            {
              type: "text",
              text: `Error: Dynamic connections are disabled (--no-dynamic). ${hint}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const parsed = DynamicConnectionInputSchema.parse(input);
        const { latencyMs, version } = await setDynamicConnection(parsed);
        const conn = getDynamicSession()!;

        return {
          content: [
            {
              type: "text",
              text: [
                "Dynamic connection established.",
                `Target: ${describeConnection(conn)}`,
                `Status: connected`,
                `Latency: ${latencyMs}ms`,
                `Version: ${version}`,
                `Read-only: ${conn.readOnly}`,
                "",
                "Next steps (omit 'database' parameter on all calls):",
                "  mdb_list_tables()",
                "  mdb_list_schemas()",
                "  mdb_query(query=\"SELECT ...\")",
                "  mdb_describe_table(table=\"...\")",
                "  mdb_health_check()",
                "",
                "Call mdb_disconnect() when finished.",
              ].join("\n"),
            },
          ],
        };
      } catch (e) {
        await clearDynamicConnection();
        return errorResult(e);
      }
    }
  );

  server.tool(
    "mdb_disconnect",
    "Close the active dynamic connection set via mdb_connect. Config-based connections are unaffected.",
    {},
    async () => {
      if (!hasDynamicConnection()) {
        return {
          content: [{ type: "text", text: "No dynamic connection is active." }],
        };
      }

      const target = describeConnection(getDynamicSession()!);
      await clearDynamicConnection();
      return {
        content: [
          {
            type: "text",
            text: `Dynamic connection closed (${target}). Use mdb_connect to establish a new runtime connection, or pass a database label from config.`,
          },
        ],
      };
    }
  );

  server.tool(
    "mdb_list_databases",
    "ALWAYS call this first to discover how to connect. Returns configured database labels from config.json, active dynamic session status, and step-by-step connection instructions for the AI.",
    {},
    async () => {
      const loaded = await loadConfig();
      const labels = loaded.map((c) => c.label);
      const lines: string[] = [];

      if (LABEL_FILTER || NO_DYNAMIC) {
        const restrictions: string[] = [];
        if (LABEL_FILTER) restrictions.push(`label="${LABEL_FILTER}"`);
        if (NO_DYNAMIC) restrictions.push("dynamic connections disabled");
        lines.push(`RESTRICTED MODE: ${restrictions.join(", ")}`);
        lines.push("");
      }

      if (hasDynamicConnection()) {
        const c = getDynamicSession()!;
        const flags: string[] = ["dynamic", "active"];
        if (!c.readOnly) flags.push("RW");
        lines.push(
          `ACTIVE SESSION: ${describeConnection(c)} [${flags.join(", ")}]`
        );
        lines.push("");
        lines.push(
          "Dynamic session is active. Call other tools WITHOUT the database parameter:"
        );
        lines.push("  mdb_list_tables()");
        lines.push("  mdb_query(query=\"SELECT ...\")");
        lines.push("  mdb_health_check()");
        lines.push("");
      }

      if (loaded.length === 0 && !hasDynamicConnection()) {
        return {
          content: [
            {
              type: "text",
              text: [
                "No configured databases and no active dynamic session.",
                "",
                buildConnectionGuidance(false, []),
              ].join("\n"),
            },
          ],
        };
      }

      if (loaded.length > 0) {
        lines.push("CONFIGURED DATABASES (use label as 'database' parameter):");
        lines.push(
          ...loaded.map((c) => {
            const addr = describeConnection(c);
            const flags: string[] = [];
            if (!c.readOnly) flags.push("RW");
            const suffix = flags.length ? ` [${flags.join(", ")}]` : "";
            return `  - ${c.label}: ${addr}${suffix}`;
          })
        );
        lines.push("");
        if (!hasDynamicConnection()) {
          lines.push("Example with config label:");
          lines.push(`  mdb_query(database="${labels[0]}", query="SELECT 1")`);
          lines.push(`  mdb_list_tables(database="${labels[0]}")`);
          lines.push("");
        }
      }

      if (!hasDynamicConnection()) {
        lines.push(buildConnectionGuidance(loaded.length > 0, labels));
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}

function registerCatalogTools(server: McpServer): void {
  server.tool(
    "mdb_list_tables",
    "List tables in MonetDB. Omit database if dynamic session active; otherwise pass database=\"config_label\". Call mdb_list_databases first if unsure.",
    {
      database: optionalDatabaseParam,
      schema: z
        .string()
        .optional()
        .describe("Schema name (omit to list all non-system schemas)"),
    },
    async ({ database, schema }) => {
      try {
        const sql = schema
          ? `SELECT table_schema, table_name, table_type
             FROM information_schema.tables
             WHERE NOT is_system AND table_schema = '${schema.replace(/'/g, "''")}'
             ORDER BY table_schema, table_name`
          : `SELECT table_schema, table_name, table_type
             FROM information_schema.tables
             WHERE NOT is_system
             ORDER BY table_schema, table_name`;

        const result = await withConnection(database, (conn, cfg) =>
          executeQuery(conn, sql, cfg.readOnly)
        );

        if (result.rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: schema
                  ? `No tables found in schema "${schema}".`
                  : "No user tables found.",
              },
            ],
          };
        }

        const lines = result.rows.map(
          (r) => `- ${r.table_schema}.${r.table_name} (${r.table_type})`
        );
        return {
          content: [
            {
              type: "text",
              text: `Tables (${result.rows.length}):\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (e) {
        return handleToolError(e);
      }
    }
  );

  server.tool(
    "mdb_describe_table",
    "Describe table columns and types. Omit database if dynamic session active; otherwise pass database=\"config_label\".",
    {
      database: optionalDatabaseParam,
      table: z.string().describe("Table name"),
      schema: z
        .string()
        .optional()
        .describe("Schema name (omit to search all non-system schemas)"),
    },
    async ({ database, table, schema }) => {
      try {
        const schemaFilter = schema
          ? `AND c.table_schema = '${schema.replace(/'/g, "''")}'`
          : "AND NOT t.is_system";

        const sql = `
          SELECT c.table_schema, c.column_name, c.data_type, c.character_maximum_length,
                 c.is_nullable, c.column_default, c.ordinal_position
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON c.table_schema = t.table_schema AND c.table_name = t.table_name
          WHERE c.table_name = '${table.replace(/'/g, "''")}'
            ${schemaFilter}
          ORDER BY c.table_schema, c.ordinal_position`;

        const result = await withConnection(database, (conn, cfg) =>
          executeQuery(conn, sql, cfg.readOnly)
        );

        if (result.rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: schema
                  ? `Table "${schema}"."${table}" not found or has no columns.`
                  : `Table "${table}" not found in any non-system schema.`,
              },
            ],
          };
        }

        const resolvedSchema = schema ?? String(result.rows[0].table_schema);
        const colLines = result.rows.map((col) => {
          let type = String(col.data_type);
          if (col.character_maximum_length) {
            type += `(${col.character_maximum_length})`;
          }
          const parts = [`  ${col.column_name}: ${type}`];
          if (col.is_nullable === "NO") parts.push("NOT NULL");
          if (col.column_default) parts.push(`DEFAULT ${col.column_default}`);
          return parts.join(" ");
        });

        const text = `Table "${resolvedSchema}"."${table}" (${result.rows.length} columns):\n${colLines.join("\n")}`;
        return { content: [{ type: "text", text }] };
      } catch (e) {
        return handleToolError(e);
      }
    }
  );

  server.tool(
    "mdb_list_schemas",
    "List schemas. Omit database if dynamic session active; otherwise pass database=\"config_label\".",
    { database: optionalDatabaseParam },
    async ({ database }) => {
      try {
        const sql = `
          SELECT schema_name,
                 (SELECT count(*) FROM information_schema.tables t
                  WHERE t.table_schema = s.schema_name AND NOT t.is_system) AS table_count
          FROM information_schema.schemata s
          WHERE NOT is_system
          ORDER BY schema_name`;

        const result = await withConnection(database, (conn, cfg) =>
          executeQuery(conn, sql, cfg.readOnly)
        );

        const lines = result.rows.map(
          (r) => `- ${r.schema_name} (${r.table_count} tables)`
        );
        return {
          content: [
            {
              type: "text",
              text: `Schemas (${result.rows.length}):\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (e) {
        return handleToolError(e);
      }
    }
  );
}

function registerQueryTools(server: McpServer): void {
  server.tool(
    "mdb_query",
    "Execute SQL against MonetDB. Connection: (1) active dynamic session from mdb_connect — omit database; (2) config label — pass database=\"label\". Call mdb_list_databases first if unsure.",
    {
      database: optionalDatabaseParam,
      query: z.string().describe("SQL query to execute"),
      limit: z
        .coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max rows to return (truncates results if exceeded)"),
    },
    async ({ database, query, limit }) => {
      try {
        if (!isSingleStatement(query)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Multi-statement queries are not allowed. Send one statement at a time.",
              },
            ],
            isError: true,
          };
        }

        const { config: connConfig } = await resolveConnection(database);

        if (connConfig.readOnly && !isReadOnlyQuery(query)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Write operations are not allowed on read-only connections. Set readOnly: false in mdb_connect or config to enable writes.",
              },
            ],
            isError: true,
          };
        }

        const result = await withConnection(database, (conn, cfg) =>
          executeQuery(conn, query, cfg.readOnly)
        );

        if (result.rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `Query executed. ${result.rowCount} row(s) affected. No rows returned.`,
              },
            ],
          };
        }

        const totalRows = result.rows.length;
        const rows =
          limit && totalRows > limit ? result.rows.slice(0, limit) : result.rows;
        const truncated = limit !== undefined && totalRows > limit;

        const payload: Record<string, unknown> = {
          columns: result.columns,
          rows,
          rowCount: result.rowCount,
        };
        if (truncated) {
          payload.truncated = true;
          payload.totalRows = totalRows;
          payload.limit = limit;
        }

        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
      } catch (e) {
        return handleToolError(e);
      }
    }
  );

  server.tool(
    "mdb_health_check",
    "Test connectivity and return MonetDB version. Omit database if dynamic session active; otherwise pass database=\"config_label\".",
    { database: optionalDatabaseParam },
    async ({ database }) => {
      try {
        const { config: connConfig, source } = await resolveConnection(database);
        const start = Date.now();
        const result = await withConnection(database, async (conn) => {
          const res = await conn.execute(`
            SELECT value AS version
            FROM sys.environment
            WHERE name = 'monet_version'
          `);
          return normalizeResult(res);
        });
        const latencyMs = Date.now() - start;

        const version = result.rows[0]?.version ?? "unknown";
        const target =
          source === "dynamic"
            ? describeConnection(connConfig)
            : `${database} (${describeConnection(connConfig)})`;

        return {
          content: [
            {
              type: "text",
              text: [
                `Database: ${target}`,
                `Source: ${source}`,
                `Status: connected`,
                `Latency: ${latencyMs}ms`,
                `Version: ${version}`,
              ].join("\n"),
            },
          ],
        };
      } catch (e) {
        return handleToolError(e);
      }
    }
  );

  server.tool(
    "mdb_explain",
    "Run EXPLAIN on a query. Omit database if dynamic session active; otherwise pass database=\"config_label\". Always rolled back.",
    {
      database: optionalDatabaseParam,
      query: z.string().describe("SQL query to analyze"),
    },
    async ({ database, query }) => {
      try {
        if (!isSingleStatement(query)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Multi-statement queries are not allowed.",
              },
            ],
            isError: true,
          };
        }

        const explainQuery = `EXPLAIN ${query}`;
        const result = await withConnection(database, (conn, cfg) =>
          executeQuery(conn, explainQuery, cfg.readOnly)
        );

        if (result.rows.length === 0) {
          return { content: [{ type: "text", text: "No plan returned." }] };
        }

        const plan = result.rows
          .map((r) => Object.values(r).join(" "))
          .join("\n");

        return { content: [{ type: "text", text: plan }] };
      } catch (e) {
        return handleToolError(e);
      }
    }
  );
}
