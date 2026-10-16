import { join, resolve } from "path";

const HOME = process.env.USERPROFILE || process.env.HOME || "";

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
}

/** --config <path>  or  MCP_MONETDB_CONFIG env  or  default */
export const CONFIG_PATH = resolve(
  getArg("--config") ||
    process.env.MCP_MONETDB_CONFIG ||
    join(HOME, ".mcp-monetdb", "config.json")
);

/** --label <name>  — if set, only this database is visible */
export const LABEL_FILTER = getArg("--label");

/** --no-dynamic  — disable mdb_connect; config labels only */
export const NO_DYNAMIC = process.argv.includes("--no-dynamic");
