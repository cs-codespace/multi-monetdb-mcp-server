#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { stat } from "fs/promises";
import { platform } from "os";
import { CONFIG_PATH, LABEL_FILTER, NO_DYNAMIC } from "./config/cli.js";
import { drainAllConnections } from "./connection/manager.js";
import { registerTools } from "./tools/index.js";

// Re-export for tests
export { resolveEnvVars } from "./config/loader.js";
export { isSingleStatement, isReadOnlyQuery } from "./sql/safety.js";

const server = new McpServer({
  name: "monetdb",
  version: "1.0.0",
});

registerTools(server);

async function shutdown() {
  console.error("Shutting down — closing connections...");
  await drainAllConnections();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function checkConfigPermissions(): Promise<void> {
  if (platform() === "win32") return;

  try {
    const s = await stat(CONFIG_PATH);
    const mode = s.mode & 0o777;
    if (mode & 0o077) {
      console.error(
        `Warning: Config file ${CONFIG_PATH} has permissions ${mode.toString(8)}. ` +
          `Consider restricting with: chmod 600 ${CONFIG_PATH}`
      );
    }
  } catch {
    // skip
  }
}

async function main() {
  await checkConfigPermissions();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const parts = [LABEL_FILTER ? `label="${LABEL_FILTER}"` : "all databases"];
  if (NO_DYNAMIC) parts.push("no-dynamic");
  console.error(`mcp-monetdb started (${parts.join(", ")}) | config: ${CONFIG_PATH}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
