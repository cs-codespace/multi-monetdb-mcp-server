import { getConfigLabels } from "../config/loader.js";

export function buildConnectionGuidance(
  hasConfig: boolean,
  configLabels: string[]
): string {
  const lines: string[] = [
    "=== MonetDB Connection Guide ===",
    "",
    "There are TWO ways to connect. Choose based on whether databases are pre-configured.",
    "",
    "── Option A: Named database from config.json ──",
    "Use when connections are pre-defined with a label in config.json.",
    "",
    "  Step 1: mdb_list_databases()",
    "          → returns labels like: analytics, staging, local",
    "",
    "  Step 2: pass the label as the 'database' parameter:",
    "          mdb_query(database=\"analytics\", query=\"SELECT ...\")",
    "          mdb_list_tables(database=\"analytics\")",
    "          mdb_health_check(database=\"analytics\")",
    "",
  ];

  if (hasConfig && configLabels.length > 0) {
    lines.push(`  Available config labels: ${configLabels.join(", ")}`);
    lines.push("");
  } else {
    lines.push("  (No config-file databases found.)");
    lines.push("");
  }

  lines.push(
    "── Option B: User-provided connection (dynamic, no config) ──",
    "Use when the user gives you connection details directly, or config.json is empty.",
    "",
    "  Step 1: Ask the user for connection details if not already provided:",
    "          - host (e.g. localhost)",
    "          - port (default 50000)",
    "          - user (e.g. monetdb)",
    "          - password",
    "          - database name",
    "    OR a full MAPI URL: mapi:monetdb://user:pass@host:50000/db",
    "",
    "  Step 2: mdb_connect(host=\"...\", port=50000, user=\"...\", password=\"...\", database=\"...\")",
    "          → runs health check; on success the session becomes active",
    "",
    "  Step 3: Call other tools WITHOUT the database parameter:",
    "          mdb_list_tables()",
    "          mdb_query(query=\"SELECT ...\")",
    "          mdb_describe_table(table=\"my_table\")",
    "          mdb_health_check()",
    "",
    "  Step 4 (optional): mdb_disconnect() when done",
    "",
    "── Rules ──",
    "- Dynamic connection (Option B) takes precedence over config labels.",
    "- While a dynamic session is active, omit 'database' on all other tools.",
    "- Dynamic credentials are never saved to config.json.",
    "- Default port: 50000. Default read-only: true.",
    "- Always call mdb_list_databases() first if unsure which mode applies."
  );

  return lines.join("\n");
}

export function connectionRequiredResult(configLabels: string[] = []) {
  return {
    content: [
      {
        type: "text" as const,
        text: buildConnectionGuidance(configLabels.length > 0, configLabels),
      },
    ],
    isError: true,
  };
}

export function errorResult(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
    isError: true,
  };
}

export async function handleToolError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("No active connection")) {
    return connectionRequiredResult(await getConfigLabels());
  }
  return errorResult(e);
}
