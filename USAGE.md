# MonetDB MCP Server — Usage Guide

This guide explains how an AI agent (or developer) should use the MonetDB MCP tools. There are **two connection modes**. The server tells you which mode applies — always start with `mdb_list_databases`.

---

## Quick decision

```
User asks about MonetDB data
         │
         ▼
   mdb_list_databases()
         │
    ┌────┴────┐
    │         │
 Config     No config
 labels     + no session
 found          │
    │           ▼
    │     Ask user for:
    │     host, port, user,
    │     password, database
    │           │
    │           ▼
    │     mdb_connect(...)
    │           │
    └─────┬─────┘
          ▼
   Use other mdb_* tools
```

---

## Mode A: Pre-configured database (config.json)

Use when databases are defined in `~/.mcp-monetdb/config.json` with a **label** (name).

### Config file example

```json
{
  "connections": [
    {
      "label": "analytics",
      "host": "db.example.com",
      "port": 50000,
      "user": "readonly_user",
      "password": "secret",
      "database": "analytics",
      "enabled": true,
      "readOnly": true
    },
    {
      "label": "staging",
      "host": "staging.example.com",
      "port": 50000,
      "user": "dev",
      "password": "devpass",
      "database": "analytics_staging",
      "enabled": true,
      "readOnly": false
    }
  ]
}
```

The **label** (`analytics`, `staging`) is what you pass as the `database` parameter in tool calls.

### MCP tool call sequence

**Step 1 — Discover available labels**

```
Tool:  mdb_list_databases
Args:  (none)

Response:
  CONFIGURED DATABASES (use label as 'database' parameter):
    - analytics: readonly_user@db.example.com:50000/analytics
    - staging: dev@staging.example.com:50000/analytics_staging [RW]

  Example with config label:
    mdb_query(database="analytics", query="SELECT 1")
    mdb_list_tables(database="analytics")
```

**Step 2 — Query using the label**

```
Tool:  mdb_list_tables
Args:  { "database": "analytics" }

Tool:  mdb_query
Args:  {
         "database": "analytics",
         "query": "SELECT count(*) FROM sales"
       }

Tool:  mdb_describe_table
Args:  { "database": "analytics", "table": "sales" }

Tool:  mdb_health_check
Args:  { "database": "analytics" }

Tool:  mdb_explain
Args:  {
         "database": "analytics",
         "query": "SELECT * FROM sales WHERE year = 2024"
       }
```

### Rules for Mode A

| Rule | Detail |
|---|---|
| `database` parameter | **Required** on every tool call (unless dynamic session is active) |
| Value | Must match a `label` from config.json exactly |
| Credentials | Never passed in tool calls — already in config |
| Hot reload | Add/edit config.json — changes apply within ~5 seconds, no restart |

---

## Mode B: User-provided connection (dynamic)

Use when:
- No `config.json` exists or it is empty
- User gives you connection details in chat
- User wants to connect to a database not in config

Credentials are **never saved** to config. They exist only for the MCP server process lifetime.

### What to ask the user

If the user has not provided connection details, ask for:

| Field | Required | Default | Example |
|---|---|---|---|
| host | Yes* | — | `localhost` |
| port | No | `50000` | `50000` |
| user | Yes* | — | `monetdb` |
| password | Yes* | — | `monetdb` |
| database | Yes* | — | `demo` |

\* Not required if user provides a full MAPI URL instead.

**Alternative — single URL:**

```
mapi:monetdb://user:password@hostname:50000/database
```

### MCP tool call sequence

**Step 1 — Discover no config exists**

```
Tool:  mdb_list_databases
Args:  (none)

Response:
  No configured databases and no active dynamic session.

  === MonetDB Connection Guide ===
  ...
  ── Option B: User-provided connection (dynamic, no config) ──
  Step 1: Ask the user for connection details...
  Step 2: mdb_connect(host="...", port=50000, user="...", password="...", database="...")
  Step 3: Call other tools WITHOUT the database parameter...
```

**Step 2 — Connect with user-provided credentials**

```
Tool:  mdb_connect
Args:  {
         "host": "localhost",
         "port": 50000,
         "user": "monetdb",
         "password": "monetdb",
         "database": "demo"
       }

Response:
  Dynamic connection established.
  Target: monetdb@localhost:50000/demo
  Status: connected
  Latency: 42ms
  Version: MonetDB 11.x

  Next steps (omit 'database' parameter on all calls):
    mdb_list_tables()
    mdb_list_schemas()
    mdb_query(query="SELECT ...")
    mdb_describe_table(table="...")
    mdb_health_check()
```

Or with URL:

```
Tool:  mdb_connect
Args:  {
         "url": "mapi:monetdb://monetdb:monetdb@localhost:50000/demo"
       }
```

**Step 3 — Use other tools (no `database` parameter)**

```
Tool:  mdb_list_tables
Args:  {}

Tool:  mdb_list_schemas
Args:  {}

Tool:  mdb_query
Args:  { "query": "SELECT * FROM my_table LIMIT 10" }

Tool:  mdb_describe_table
Args:  { "table": "my_table" }

Tool:  mdb_health_check
Args:  {}
```

**Step 4 — Disconnect when done (optional)**

```
Tool:  mdb_disconnect
Args:  (none)
```

### Rules for Mode B

| Rule | Detail |
|---|---|
| `database` parameter | **Omit** on all tools after `mdb_connect` succeeds |
| Precedence | Dynamic session overrides config labels while active |
| Reconnect | Calling `mdb_connect` again replaces the previous session |
| Persistence | Connection lost when MCP server process restarts |
| Read-only | Default `true`; pass `"readOnly": false` to allow writes |

---

## What happens when you call a tool without a connection

If you call `mdb_query`, `mdb_list_tables`, etc. without:
- an active dynamic session, AND
- a `database` label parameter

The tool returns a **connection guide** (not a generic error):

```
=== MonetDB Connection Guide ===

── Option A: Named database from config.json ──
  Step 1: mdb_list_databases()
  Step 2: mdb_query(database="analytics", query="SELECT ...")

  Available config labels: analytics, staging

── Option B: User-provided connection (dynamic, no config) ──
  Step 1: Ask the user for connection details...
  Step 2: mdb_connect(host="...", ...)
  Step 3: Call other tools WITHOUT the database parameter...
```

---

## Complete example sessions

### Session 1 — Configured database

```
User: "Show me tables in the analytics database"

AI:   mdb_list_databases()
      → sees label "analytics"

AI:   mdb_list_tables(database="analytics")
      → returns table list

User: "Describe the sales table"

AI:   mdb_describe_table(database="analytics", table="sales")
```

### Session 2 — User provides credentials (no config)

```
User: "Connect to MonetDB at localhost, database demo, user monetdb, password monetdb"

AI:   mdb_connect(host="localhost", port=50000, user="monetdb",
                  password="monetdb", database="demo")
      → connection established

AI:   mdb_list_tables()
      → returns table list

User: "How many rows in orders?"

AI:   mdb_query(query="SELECT count(*) FROM orders")
```

### Session 3 — No config, user hasn't provided credentials yet

```
User: "Query my MonetDB database"

AI:   mdb_list_databases()
      → no config, no session, returns connection guide

AI:   "I need connection details to connect. Please provide:
       - host (e.g. localhost)
       - port (default 50000)
       - username
       - password
       - database name"

User: "host is db.corp.com, user analyst, password xxx, database warehouse"

AI:   mdb_connect(host="db.corp.com", user="analyst",
                  password="xxx", database="warehouse")
AI:   mdb_list_tables()
```

---

## Tool reference summary

| Tool | When to use | `database` param |
|---|---|---|
| `mdb_list_databases` | **Always call first** | — |
| `mdb_connect` | User gave credentials, no config | — |
| `mdb_disconnect` | Done with dynamic session | — |
| `mdb_query` | Run SQL | Required (Mode A) / omit (Mode B) |
| `mdb_list_tables` | Discover tables | Required (Mode A) / omit (Mode B) |
| `mdb_describe_table` | Column info | Required (Mode A) / omit (Mode B) |
| `mdb_list_schemas` | List schemas | Required (Mode A) / omit (Mode B) |
| `mdb_health_check` | Verify connection | Required (Mode A) / omit (Mode B) |
| `mdb_explain` | Query plan | Required (Mode A) / omit (Mode B) |

---

## Cursor MCP setup

See [README — Restricting access per project](./README.md#restricting-access-per-project-cursor) for full details.

**Basic setup:**

```json
{
  "mcpServers": {
    "monetdb": {
      "command": "node",
      "args": [
        "C:/Code/MCPServer/multi-monetdb-mcp-server/dist/index.js"
      ]
    }
  }
}
```

**Restrict to one environment per project (`--label`):**

```json
{
  "mcpServers": {
    "monetdb": {
      "command": "node",
      "args": [
        "C:/Code/MCPServer/multi-monetdb-mcp-server/dist/index.js",
        "--label",
        "analytics"
      ]
    }
  }
}
```

With `--label analytics`, only that connection appears in `mdb_list_databases`. The AI uses `database="analytics"` on tool calls.

**Lock down production (recommended):**

```json
{
  "mcpServers": {
    "monetdb": {
      "command": "node",
      "args": [
        "C:/Code/MCPServer/multi-monetdb-mcp-server/dist/index.js",
        "--label",
        "production",
        "--no-dynamic"
      ]
    }
  }
}
```

`--no-dynamic` blocks `mdb_connect` so the AI cannot connect with arbitrary credentials pasted in chat.

**Project-specific config file (`--config`):**

```json
{
  "mcpServers": {
    "monetdb": {
      "command": "node",
      "args": [
        "C:/Code/MCPServer/multi-monetdb-mcp-server/dist/index.js",
        "--config",
        "C:/Projects/MyApp/.cursor/monetdb.json"
      ]
    }
  }
}
```

Put only the connections that project needs in `.cursor/monetdb.json`.
