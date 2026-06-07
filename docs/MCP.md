# Connect an AI agent (MCP) — the agent shell

Comb ships an [MCP](https://modelcontextprotocol.io) server so any agentic
environment — Claude Code, Claude Desktop, Cursor, and other MCP hosts — can use
the brain as native tools. It's a thin shell over the **same kernel** the
dashboard and HTTP API use: point them all at one store (pgvector/Langbase) and
data ingested by a workflow is instantly available to your agent.

## Register it

The server speaks stdio, so it registers like any MCP server. One line:

```jsonc
{
  "mcpServers": {
    "open-brain": {
      "command": "npx",
      "args": ["-y", "open-company-brain", "mcp"],
      "env": {
        "LLM_BACKEND": "local",
        "VECTOR_DATABASE_URL": "postgres://brain:brain@localhost:5433/company_brain",
        "MCP_SCOPES": "my-team"
      }
    }
  }
}
```

- **Claude Desktop** → `claude_desktop_config.json`
- **Claude Code** → `.mcp.json` (project) or `claude mcp add`
- **Cursor** → Settings → MCP → add server

`MCP_SCOPES` sets the access scopes this connection may read (defaults to
`default-team`). The `env` must point at the **same store** your other shells use,
or the agent will see a different (empty) brain.

For a source checkout, use your local build instead of npx:
`{ "command": "node", "args": ["/path/to/open-company-brain/dist/mcp/server.js"] }`
(run `npm run build` first), or `npm run mcp` during development.

## Tools

All are access-scoped and obey the cite-or-refuse trust contract.

| Tool | What it does | Who generates |
|---|---|---|
| `search_brain` | governed retrieval — returns the top records + provenance + score | the **host's** model synthesizes (cheap) |
| `ask_brain` | a grounded, cited answer from the brain's own model | **Comb** |
| `ingest` | add knowledge (also fires fan-out agents) | — |
| `list_sources` | provenance sources the caller can see | — |

## Two ways your agent "runs"

- **You bring the model (`search_brain`).** The host agent pulls the right,
  scope-filtered, cited slice exactly when its reasoning needs it, and writes the
  answer itself. Cheapest; ideal for coding/analysis tasks.
- **The brain runs the agent (`ask_brain`).** The host delegates the whole
  grounded answer to Comb's generator. Useful when you want the brain's
  governance and model to produce the result.

## Verify

In your IDE, ask the agent to "search the brain for X" — it should call
`search_brain` and ground its reply on cited records. Anything a workflow or the
dashboard ingested into the shared store will be there.
