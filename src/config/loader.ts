import { readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { z } from "zod";
import { CONFIG_PATH, LABEL_FILTER } from "./cli.js";
import { DbConfigSchema } from "./schema.js";
import type { DbConnection } from "../types.js";

interface ConfigCache {
  connections: DbConnection[];
  mtime: number;
  loadedAt: number;
}

const CONFIG_CACHE_TTL = 5_000;
let configCache: ConfigCache | null = null;

/**
 * Replaces `${VAR}` patterns in string values with process.env values.
 * Supports `${VAR:-default}` syntax for defaults when env var is unset.
 */
export function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
      const [name, ...rest] = expr.split(":-");
      const fallback = rest.join(":-");
      return process.env[name.trim()] ?? fallback ?? "";
    });
  }
  if (Array.isArray(obj)) return obj.map(resolveEnvVars);
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = resolveEnvVars(v);
    }
    return out;
  }
  return obj;
}

export async function loadConfig(): Promise<DbConnection[]> {
  try {
    if (configCache) {
      const elapsed = Date.now() - configCache.loadedAt;
      if (elapsed < CONFIG_CACHE_TTL) return configCache.connections;

      try {
        const s = await stat(CONFIG_PATH);
        if (s.mtimeMs === configCache.mtime) {
          configCache.loadedAt = Date.now();
          return configCache.connections;
        }
      } catch {
        // fall through
      }
    }

    const raw = await readFile(CONFIG_PATH, "utf-8");
    const jsonWithEnv = resolveEnvVars(JSON.parse(raw));
    const parsed = DbConfigSchema.parse(jsonWithEnv);

    let loaded: DbConnection[];
    if (Array.isArray(parsed.connections)) {
      loaded = parsed.connections;
    } else {
      loaded = Object.values(parsed.connections);
    }

    const seen = new Set<string>();
    for (const c of loaded) {
      if (seen.has(c.label)) {
        console.error(
          `Warning: duplicate label "${c.label}" in config — using first occurrence`
        );
      }
      seen.add(c.label);
    }

    loaded = loaded.filter(
      (c, i, arr) => arr.findIndex((x) => x.label === c.label) === i
    );

    loaded = loaded.filter((c) => c.enabled !== false);

    if (LABEL_FILTER) {
      loaded = loaded.filter((c) => c.label === LABEL_FILTER);
    }

    try {
      const s = await stat(CONFIG_PATH);
      configCache = { connections: loaded, mtime: s.mtimeMs, loadedAt: Date.now() };
    } catch {
      configCache = { connections: loaded, mtime: 0, loadedAt: Date.now() };
    }

    return loaded;
  } catch (e) {
    if (!existsSync(CONFIG_PATH)) {
      console.error(`Config not found: ${CONFIG_PATH}`);
      console.error(
        "Create it with your database connections. See README for format."
      );
    } else if (e instanceof z.ZodError) {
      console.error(`Invalid config (${CONFIG_PATH}):`);
      for (const issue of e.issues) {
        console.error(`  ${issue.path.join(".")}: ${issue.message}`);
      }
    } else {
      console.error(`Failed to read config: ${CONFIG_PATH}`, e);
    }
    return [];
  }
}

export async function getConfigLabels(): Promise<string[]> {
  const loaded = await loadConfig();
  return loaded.map((c) => c.label);
}

export async function getConnection(label: string): Promise<DbConnection> {
  const loaded = await loadConfig();
  const conn = loaded.find((c) => c.label === label);
  if (!conn) {
    const available = loaded.map((c) => c.label).join(", ") || "(none)";
    throw new Error(`Database "${label}" not found. Available: ${available}`);
  }
  return conn;
}
