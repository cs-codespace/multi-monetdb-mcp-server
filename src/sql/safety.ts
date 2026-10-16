/**
 * Detects multi-statement SQL to prevent injection via statement stacking.
 */
export function isSingleStatement(sql: string): boolean {
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];
    const next = i + 1 < len ? sql[i + 1] : "";

    if (ch === "-" && next === "-") {
      i = sql.indexOf("\n", i);
      if (i === -1) return true;
      i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return true;
      i = end + 2;
      continue;
    }

    if (ch === "'") {
      i++;
      while (i < len) {
        if (sql[i] === "'") {
          if (i + 1 < len && sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      i++;
      while (i < len && sql[i] !== '"') i++;
      i++;
      continue;
    }

    if (ch === ";") {
      const rest = sql.substring(i + 1).trim();
      if (rest.length > 0) return false;
    }

    i++;
  }

  return true;
}

const WRITE_KEYWORDS =
  /^(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|MERGE|REPLACE|COPY|GRANT|REVOKE|CALL|LOAD|IMPORT|RENAME)\b/i;

/** Returns true if the SQL appears to be a read-only query. */
export function isReadOnlyQuery(sql: string): boolean {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();

  const firstWord = stripped.split(/\s+/)[0] ?? "";
  if (WRITE_KEYWORDS.test(firstWord)) return false;

  if (/^(SELECT|WITH|EXPLAIN|SHOW|DESCRIBE|DESC|VALUES)\b/i.test(firstWord)) {
    return true;
  }

  return false;
}
