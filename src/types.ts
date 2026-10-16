import type { z } from "zod";
import {
  DbConnectionSchema,
  DynamicConnectionInputSchema,
} from "./config/schema.js";

export type DbConnection = z.infer<typeof DbConnectionSchema>;
export type DynamicConnectionInput = z.infer<typeof DynamicConnectionInputSchema>;

export interface NormalizedResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface ResolvedConnection {
  config: DbConnection;
  source: "dynamic" | "config";
}

export interface MonetDbConnectionConfig {
  database: string;
  username?: string;
  password?: string;
  host?: string;
  port?: number;
  timeout?: number;
  autoCommit?: boolean;
  replySize?: number;
}
