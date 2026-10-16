import type { NormalizedResult } from "../types.js";

interface ColumnInfo {
  name: string;
  type?: string;
}

export function normalizeResult(result: unknown): NormalizedResult {
  const r = result as {
    data?: unknown[][];
    fields?: ColumnInfo[];
    header?: ColumnInfo[];
    columns?: ColumnInfo[];
    count?: number;
  };

  const fields = r.fields ?? r.header ?? r.columns ?? [];
  const columns = fields.map((f) => (typeof f === "string" ? f : f.name));

  const data = r.data ?? [];
  const rows: Record<string, unknown>[] = data.map((row) => {
    if (Array.isArray(row)) {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, idx) => {
        obj[col] = row[idx];
      });
      return obj;
    }
    return row as Record<string, unknown>;
  });

  return {
    columns,
    rows,
    rowCount: r.count ?? rows.length,
  };
}
