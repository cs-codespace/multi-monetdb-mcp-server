# multi-monetdb-mcp-server

**One MCP server for all your MonetDB databases.**

A companion to [multi-postgres-mcp-server](../multi-postgres-mcp-server), built for [MonetDB](https://www.monetdb.org/) column-store databases.

## Documentation

| Document | Audience | Contents |
|---|---|---|
| **[USAGE.md](./USAGE.md)** | AI agents & developers | Tool call sequences, decision flow, examples |
| [config.example.json](./config.example.json) | Operators | Config file template |
| This README | Setup | Install, Cursor config, environment restriction |

## Features

- **One server** for all MonetDB databases
- **Config file** with named labels (`analytics`, `staging`, …)
- **Dynamic connect** — user provides credentials at runtime via `mdb_connect`
- **Hot reload** — config changes apply within ~5 seconds, no restart
- **`--label` filter** — expose only one database per Cursor project
- **`--no-dynamic`** — block runtime `mdb_connect` for locked-down projects
- **Read-only by default** — writes blocked unless `readOnly: false`

## Two connection modes

**Always call `mdb_list_databases` first** — it tells the AI which mode applies.

| Mode | When | How |
|---|---|---|
| **A — Config label** | DB defined in `config.json` | `mdb_query(database="analytics", query="...")` |
| **B — Dynamic** | User gives credentials in chat | `mdb_connect(...)` then omit `database` on other tools |

See [USAGE.md](./USAGE.md) for full examples and AI workflow.

## Quick Start

### 1. Install & build

```bash
cd multi-monetdb-mcp-server
npm install
npm run build
```

### 2. Add to Cursor

Global or project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "monetdb": {
      "command": "node",
      "args": ["C:/Code/MCPServer/multi-monetdb-mcp-server/dist/index.js"]
    }
  }
}
```

### 3. First use

Ask the AI to call `mdb_list_databases`. It will show config labels or guide you through `mdb_connect`.

---

## Restricting access per project (Cursor)

When multiple environments exist (production, staging, dev), you can limit what the AI sees **per Cursor project** using `.cursor/mcp.json` in each project folder.

### Option 1: `--label` (single database from shared config)

One global `~/.mcp-monetdb/config.json` holds all environments. Each project exposes only its label:

**`~/.mcp-monetdb/config.json`** (shared):

```json
{
  "connections": [
    { "label": "production", "host": "prod.db.com", "port": 50000, "user": "ro", "password": "...", "database": "warehouse", "readOnly": true },
    { "label": "staging",    "host": "stg.db.com",  "port": 50000, "user": "dev", "password": "...", "database": "warehouse", "readOnly": true },
    { "label": "local",      "host": "localhost",    "port": 50000, "user": "monetdb", "password": "monetdb", "database": "demo", "readOnly": false }
  ]
}
```

**Project A** — `.cursor/mcp.json` (production only):

```json
{
  "mcpServers": {
    "monetdb": {
      "command": "node",
      "args": [
        "C:/Code/MCPServer/multi-monetdb-mcp-server/dist/index.js",
        "--label",
        "production"
      ]
    }
  }
}
```

**Project B** — `.cursor/mcp.json` (staging only):

```json
{
  "mcpServers": {
    "monetdb": {
      "command": "node",
      "args": [
        "C:/Code/MCPServer/multi-monetdb-mcp-server/dist/index.js",
        "--label",
        "staging"
      ]
    }
  }
}
```

Effect:
- `mdb_list_databases` shows **only** the filtered label
- AI cannot see other environment names
- AI uses `database="production"` (or `"staging"`) on tool calls

### Option 2: Project-specific config file

Each project has its own config with only the connections it needs:

**Project A** — `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "monetdb": {
      "command": "node",
      "args": [
        "C:/Code/MCPServer/multi-monetdb-mcp-server/dist/index.js",
        "--config",
        "C:/Projects/ProjectA/.cursor/monetdb.json"
      ]
    }
  }
}
```

**`ProjectA/.cursor/monetdb.json`**:

```json
{
  "connections": [
    {
      "label": "production",
      "host": "prod.db.com",
      "port": 50000,
      "user": "readonly",
      "password": "secret",
      "database": "warehouse",
      "readOnly": true
    }
  ]
}
```

Effect:
- Other environments are not in the file at all
- No `--label` needed — only one connection exists
- Best for strongest isolation between teams/projects

### Option 3: `--no-dynamic` (block runtime credentials)

Prevent the AI from calling `mdb_connect` with arbitrary credentials. Use with `--label` or a project config:

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

Effect:
- `mdb_connect` is rejected — config labels only
- User cannot bypass restriction by pasting credentials in chat
- Recommended for production-facing projects

### Option 4: Combine all restrictions (recommended for production)

```json
{
  "mcpServers": {
    "monetdb": {
      "command": "node",
      "args": [
        "C:/Code/MCPServer/multi-monetdb-mcp-server/dist/index.js",
        "--config",
        "C:/Projects/MyApp/.cursor/monetdb.json",
        "--label",
        "production",
        "--no-dynamic"
      ]
    }
  }
}
```

### Restriction summary

| Flag / setting | What it restricts |
|---|---|
| `--label <name>` | Only one config label visible to AI |
| `--config <path>` | Which config file to load (project-specific) |
| `--no-dynamic` | Blocks `mdb_connect` (runtime credentials) |
| `"readOnly": true` | Blocks INSERT/UPDATE/DELETE/DROP in SQL |
| `"enabled": false` | Hides a connection from shared config (soft disable) |

### Custom config via environment variable

Alternative to `--config` in args:

```json
{
  "mcpServers": {
    "monetdb": {
      "command": "node",
      "args": ["C:/Code/MCPServer/multi-monetdb-mcp-server/dist/index.js", "--label", "staging"],
      "env": {
        "MCP_MONETDB_CONFIG": "C:/Projects/MyApp/.cursor/monetdb.json"
      }
    }
  }
}
```

Default config path: `~/.mcp-monetdb/config.json`

---

## Config file reference

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
    }
  ]
}
```

| Field | Default | Description |
|---|---|---|
| `label` | (required) | Name used as `database` parameter in tool calls |
| `host` | — | MonetDB server hostname |
| `port` | `50000` | MAPI port |
| `user` | — | Username |
| `password` | `""` | Password |
| `database` | — | Database name |
| `url` | — | Full MAPI URL (alternative to host/user/password/database) |
| `enabled` | `true` | Set `false` to hide without removing |
| `readOnly` | `true` | Block write queries |
| `timeout` | `10000` | Connection timeout (ms) |

Environment variable substitution in config values:

```json
{ "password": "${MONETDB_PASSWORD:-monetdb}" }
```

## Tools

| Tool | Description |
|---|---|
| `mdb_list_databases` | **Start here.** Labels, session status, connection guide |
| `mdb_connect` | Runtime credentials (blocked when `--no-dynamic`) |
| `mdb_disconnect` | Close dynamic session |
| `mdb_query` | Execute SQL |
| `mdb_list_tables` | List tables |
| `mdb_describe_table` | Column types |
| `mdb_list_schemas` | List schemas |
| `mdb_health_check` | Connectivity check |
| `mdb_explain` | EXPLAIN plan |

## Security

- Read-only by default (`readOnly: true`)
- Use `--no-dynamic` + `--label` in production Cursor projects
- Dynamic credentials never saved to config
- Multi-statement queries rejected
- Config passwords excluded from git via `.gitignore`

## Source layout

```
src/
  index.ts                 Entry point
  types.ts                 Shared types
  config/                  CLI, schemas, loader
  connection/              Pool, dynamic session
  sql/                     Safety, query execution
  guidance/                AI connection guide
  tools/                   MCP tool registrations
```

## License

[Apache-2.0](./LICENSE)
