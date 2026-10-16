import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveEnvVars } from "../config/loader.js";
import { isSingleStatement, isReadOnlyQuery } from "../sql/safety.js";

describe("resolveEnvVars", () => {
  const ORIG_ENV = { ...process.env };

  beforeEach(() => {
    process.env.TEST_HOST = "localhost";
    process.env.TEST_PORT = "50000";
    process.env.TEST_PASS = "s3cret";
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it("replaces ${VAR} in a string", () => {
    expect(resolveEnvVars("host=${TEST_HOST}")).toBe("host=localhost");
  });

  it("uses default value with ${VAR:-default} syntax", () => {
    expect(resolveEnvVars("${NONEXISTENT_VAR_XYZ:-fallback}")).toBe("fallback");
  });

  it("processes strings in objects recursively", () => {
    const input = { host: "${TEST_HOST}", port: 50000, nested: { pass: "${TEST_PASS}" } };
    const result = resolveEnvVars(input) as Record<string, unknown>;
    expect(result.host).toBe("localhost");
    expect(result.port).toBe(50000);
    expect((result.nested as Record<string, unknown>).pass).toBe("s3cret");
  });
});

describe("isSingleStatement", () => {
  it("allows simple SELECT", () => {
    expect(isSingleStatement("SELECT * FROM users")).toBe(true);
  });

  it("allows trailing semicolon", () => {
    expect(isSingleStatement("SELECT 1;")).toBe(true);
  });

  it("rejects multi-statement SQL", () => {
    expect(isSingleStatement("SELECT 1; DROP TABLE users")).toBe(false);
  });

  it("ignores semicolons inside single-quoted strings", () => {
    expect(isSingleStatement("SELECT * FROM users WHERE name = 'foo;bar'")).toBe(true);
  });
});

describe("isReadOnlyQuery", () => {
  it("allows SELECT", () => {
    expect(isReadOnlyQuery("SELECT * FROM users")).toBe(true);
  });

  it("allows WITH (CTE)", () => {
    expect(isReadOnlyQuery("WITH cte AS (SELECT 1) SELECT * FROM cte")).toBe(true);
  });

  it("allows EXPLAIN", () => {
    expect(isReadOnlyQuery("EXPLAIN SELECT * FROM users")).toBe(true);
  });

  it("rejects INSERT", () => {
    expect(isReadOnlyQuery("INSERT INTO users VALUES (1)")).toBe(false);
  });

  it("rejects UPDATE", () => {
    expect(isReadOnlyQuery("UPDATE users SET name = 'x'")).toBe(false);
  });

  it("rejects DELETE", () => {
    expect(isReadOnlyQuery("DELETE FROM users")).toBe(false);
  });

  it("rejects DROP", () => {
    expect(isReadOnlyQuery("DROP TABLE users")).toBe(false);
  });
});
