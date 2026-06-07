# Open Brain

> **An agentic OS for companies and individuals.**
> Pipe all your data in (paste, upload, or a workflow like n8n) → it becomes
> scoped, embedded, **cited** knowledge → then run a fleet of agents on it:
> answer questions, react automatically to new data, and take human-approved
> actions. Reach it through three shells — a **dashboard**, an **HTTP API**, and
> an **MCP server** any AI agent can plug into. Everything grounded, cited, and
> access-governed.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](./tsconfig.json)
[![Runs with zero setup](https://img.shields.io/badge/demo-zero%20setup-brightgreen.svg)](#quickstart)

---

## The problem

A company (or one person) generates knowledge constantly — meeting notes, CRM
updates, support threads, workflow runs — scattered across tools. To put AI
agents to work on it, you hit three walls:

1. **No governed place for the data to live.** Getting real, live data into a
   form agents can ground on is bespoke and brittle, with no access control over
   what an agent can then see.
2. **Agents hallucinate.** A raw LLM with file access has no guarantee it's
   answering *from your data* — no citations, no "I don't know", no provenance.
3. **No operating layer for the agents themselves.** Where do agents live? How
   do they react to new data, take actions safely, and stay reachable from a
   dashboard, an app, *and* a coding agent — without a different integration each?

## What Open Brain is

An **agentic operating system** you self-host. The OS metaphor is literal:

| OS concept | In Open Brain |
|---|---|
| **Kernel** | the governed brain — all your data, embedded, access-scoped, **cite-or-refuse** |
| **Drivers** | connectors: data **in** (paste · upload · workflow webhook) and actions **out** (webhook · file), human-approved |
| **Processes** | agents that run on the kernel: **on-demand** (ask / no-code agents), **reactive** (fan-out on each new record), **acting** (propose → approve → execute) |
| **Shells** | three interfaces onto one kernel: a **dashboard**, an **HTTP API**, an **MCP server** |
| **Security** | access scopes + cite-or-refuse + audit log + a learning loop, baked into the kernel so every agent inherits them |

> **The governance is the product.** An LLM with raw access has no scoping, no
> cite-or-refuse, no provenance, no audit. Open Brain is the governed OS your
> data lives in and your agents run on.

## One kernel, three shells

```
   data in ── ingest ──▶  ┌──────────────────────────────────────┐
  (paste / n8n / upload)  │  KERNEL (the governed brain)         │
                          │  embed · access-scoped retrieval ·   │
                          │  cite-or-refuse · feedback · agents  │
                          └──────────────────────────────────────┘
                            ▲                ▲                ▲
              Dashboard (GUI)          HTTP API           MCP server
              run agents, fan-out      apps & workflows   any AI agent IDE
```

Point every shell at the **same store** (pgvector or Langbase) and it's one live
OS: data a workflow ingests over HTTP is instantly answerable in the dashboard
and searchable from your IDE over MCP.

| Who's calling | Shell | Who runs the LLM |
|---|---|---|
| a workflow (n8n), a dashboard, your app | **HTTP API / dashboard** | Open Brain (Langbase or Ollama) |
| Claude Code / Cursor / Claude Desktop | **MCP server** | the host (via `search_brain`) — or Open Brain (via `ask_brain`) |
| your own TypeScript code | **library** (`import { Brain }`) | Open Brain |

## Quickstart

### Zero-setup demo (mock backend, no credentials)

```bash
npm install
npm run demo            # → http://localhost:4000  (deterministic, offline)
```

### Real, fully-local backend ($0 / query) — Ollama + pgvector

```bash
docker compose up -d                         # pgvector on :5433
ollama pull llama3.2:1b nomic-embed-text     # or qwen2.5:3b for sharper answers
cp .env.example .env                         # set LLM_BACKEND=local + VECTOR_DATABASE_URL
npm run setup:local                          # pull check + seed pgvector
npm run demo                                 # real embeddings + real generation
```

Ingest real data and ask:

```bash
curl -s localhost:4000/api/ingest -H 'content-type: application/json' \
  -H 'x-access-scopes: my-team' \
  -d '{"format":"text","source":"notes","content":"Rivian committed $250k in sponsored research for 2026. Open action: send the agreement by June 14."}'

curl -s localhost:4000/api/ask -H 'content-type: application/json' \
  -H 'x-access-scopes: my-team' \
  -d '{"question":"What did Rivian commit to?"}'      # → grounded, cited answer
```

## Connect a workflow (n8n) — the data driver

Point an HTTP Request node at the ingest webhook; every record that lands becomes
retrievable and triggers your fan-out agents. Set `INGEST_API_KEY` to require auth.

```
POST http://your-host:4000/api/ingest
Authorization: Bearer <INGEST_API_KEY>
{ "format": "text", "source": "n8n", "content": "…data from your workflow…" }
```

Ready-to-import workflow: [`examples/n8n-workflow.json`](./examples/n8n-workflow.json) · guide: **[docs/N8N.md](./docs/N8N.md)**.

## Connect an AI agent (MCP) — the agent shell

Register the OS in any agent IDE:

```jsonc
{
  "mcpServers": {
    "open-brain": { "command": "npx", "args": ["-y", "open-company-brain", "mcp"] }
  }
}
```

Tools (all scope-gated, cite-or-refuse): `search_brain`, `ask_brain`, `ingest`,
`list_sources`. See **[docs/MCP.md](./docs/MCP.md)**.

## Operate it from the CLI (the harness)

The harness is the operator shell: bring any agent, connect any MCP, run on the
governed kernel — from your terminal.

```bash
company-brain connect knit -- npx -y knit-mcp@latest   # be an MCP HOST: add any MCP
company-brain tools                                    # kernel tools + every connected MCP's tools
company-brain run "summarize what's open across the brain" --scopes my-team
company-brain chat                                     # interactive agent REPL
```

`run`/`chat` use a tool-loop agent on the local backend (it autonomously calls
`brain.search` and any connected MCP tool, scope-gated) and the built-in grounded
agent elsewhere. `--agent builtin|tools` forces one.

## Embed it as a library

```ts
import { Brain } from 'open-company-brain';
const brain = await Brain.create();
await brain.ingest({ format: 'text', source: 'notes', content: '…' }, ['my-team']);
const { answer, sources } = await brain.ask('…', ['my-team']);
```

## Three backends (no code change — set `LLM_BACKEND`)

| Backend | What | Cost |
|---|---|---|
| `mock` | deterministic, offline — zero credentials | $0 |
| `langbase` | managed Memory + Pipes | usage |
| `local` | Ollama generation + Ollama embeddings + pgvector | **$0 / query** |

## HTTP API (selected)

```
POST /api/ingest                { format, content, source?, scope? }   data in (auth-gated)
POST /api/ask                   { question }                           grounded answer + sources
GET  /api/health-check          attention agent (what needs follow-up)
GET  /api/stats                 real per-source counts
GET/POST /api/fanout/agents     reaction agents (run on each ingest)
GET  /api/fanout/results        their cited outputs
POST /api/actions/propose       { title, instruction, query }          human-approved action
POST /api/agents/run            { instruction, query }                 no-code agent
```

## Scripts

```
npm run demo          run the dashboard + API (http://localhost:4000)
npm run mcp           run the MCP server (stdio)
npm run setup:local   provision the fully-local backend
npm run setup:live    provision the managed (Langbase) backend
npm test              vitest
npm run typecheck     tsc --noEmit
```

## Documentation

- [docs/GETTING_STARTED.md](./docs/GETTING_STARTED.md) — full setup
- [docs/N8N.md](./docs/N8N.md) — connect a workflow
- [docs/MCP.md](./docs/MCP.md) — connect an AI agent
- [ARCHITECTURE.md](./ARCHITECTURE.md) — how it's built
- [CHANGELOG.md](./CHANGELOG.md)

## License

MIT — see [LICENSE](./LICENSE).
