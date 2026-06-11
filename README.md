<div align="center">

# 🐝 Comb

### Your company's agentic OS harness — Claude Code, but for your *own* agents.

Pipe in your data, build agents by answering a few questions, and run them from one
CLI — over a **governed brain** that cites its sources or refuses, respects access
scopes, and never plays yes‑man. Bring any model (local or cloud) and connect any
tool, API, or MCP server — including your own.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](./tsconfig.json)
[![Tests](https://img.shields.io/badge/tests-176%20passing-brightgreen.svg)](#development)
[![$0 local](https://img.shields.io/badge/local-%240%2Fquery-brightgreen.svg)](#backends)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](#roadmap)

</div>

---

## What is Comb?

Comb is an open‑source, self‑hosted **agentic operating system harness**. Think of
**Claude Code** — a CLI agent that works on your codebase — but generalized so a
**company (or one person) can build and run their own agents over their own
knowledge**, governed.

It maps cleanly onto an OS:

| OS concept | In Comb |
|---|---|
| **Kernel** | the governed brain — all your data, embedded, access‑scoped, **cite‑or‑refuse** |
| **Drivers** | data **in** (paste · upload · API · workflow webhook like n8n) and actions **out** (webhook · file), human‑approved |
| **Processes** | agents that run on the kernel: on‑demand, reactive (fan‑out on new data), and acting (propose → approve → execute) |
| **Harness** | the CLI that *runs* any agent on any model (local/cloud) with the rules applied: scopes, tools, memory, anti‑drift, anti‑sycophancy |
| **Tools** | the kernel's tools + **any MCP server / API you connect**, aggregated and namespaced |

```
┌────────────────────────────── comb (CLI) ──────────────────────────────┐
│                                                                         │
│      HARNESS  ───────  AI MODEL  (local Ollama · or any cloud model)     │
│         │                                                               │
│         └────────  TOOLS  (the brain · your APIs · any MCP, incl. knit) │
│                                                                         │
│   governed kernel:  embed · access‑scoped recall · cite‑or‑refuse        │
└─────────────────────────────────────────────────────────────────────────┘
```

> **The governance is the product.** A raw LLM with file access has no access
> scoping, no cite‑or‑refuse, no provenance, no audit. Comb is the governed layer
> your data lives in and your agents run on.

## Why it's different

Most agent platforms are **agent‑centric and single‑user** (one smart assistant
that grows with you). Comb is **governance‑centric, multi‑agent, and
organizational** — a substrate a whole company's agents run on:

- ⚖️ **Governed by default** — access scopes enforced in SQL on every read, a durable audit trail, and a human‑approved (or rate‑capped policy‑approved) action layer, all in the kernel so every agent inherits them.
- 🎯 **Refusal decided in code, not by the model** — a **calibrated grounding floor** (`comb calibrate`) gates every generation: thin retrieval → deterministic refusal *before* the model runs. Cite‑or‑refuse that holds on the real vector path.
- 🧪 **Agentic evals built in** — `comb eval` asserts behaviour (cites · refuses · tool use · budgets · scope), plus a live LLM‑judge layer; `comb promote` turns any production failure into a permanent regression test.
- 🔬 **Observability** — every run traced (`comb runs` / `comb trace`): steps, tokens, latency; failure‑shaped runs triaged with `--failed`.
- 🔌 **Bring any model & any tool** — local Ollama ($0/query) **or any OpenAI‑compatible key** (OpenAI, Groq, Together, OpenRouter, LM Studio, vLLM); connect any API or MCP server into one namespaced toolset. Dynamic context window, token budgets, response caching, retries.
- 🧠 **Agents are data** — one prompt (`comb new`) builds a saved agent with hygiene‑guarded persistent memory; versioned rows, not containers.
- 🏢 **Built for organizations** — multi‑scope access control is first‑class, not an afterthought.
- 🛠️ **Yours to self‑host** — embed it as a library, run the API for apps/workflows, or operate it from the CLI.

## Quickstart

### Zero‑setup demo (no credentials)

```bash
git clone https://github.com/PDgit12/open-company-brain.git
cd open-company-brain && npm install
npm run demo          # → http://localhost:4000  (landing page + HTTP API)
```

### Real, fully‑local — Ollama + pgvector ($0 / query)

```bash
docker compose up -d                         # pgvector on :5433
ollama pull qwen2.5:3b nomic-embed-text      # a tool-capable model + embeddings
cp .env.example .env                         # set LLM_BACKEND=local + VECTOR_DATABASE_URL
npm run build && npm link                    # makes `comb` available globally
comb init                                    # guided setup
```

## Use it from the CLI (the harness)

```bash
# bring data in (or point an API / n8n workflow at the ingest webhook)
curl -s localhost:4000/api/ingest -H 'content-type: application/json' \
  -H 'x-access-scopes: my-team' \
  -d '{"format":"text","source":"notes","content":"Acme signed a 2-year contract. Open action: send renewal terms by Friday."}'

# connect any tool / MCP server — the agent picks them up automatically
comb connect knit -- npx -y knit-mcp@latest
comb tools                                   # everything an agent can use

# feed the brain straight from the CLI (no server needed)
comb ingest ./handbook.md --source handbook

# ONE PROMPT builds a complete agent (+ starter calibration labels)
comb new "an agent that answers leave and policy questions"
comb calibrate --labels calibration-<slug>.json   # place the grounding floor from YOUR data

# run agents over your governed brain + connected tools
comb run "what's open across my-team this week?" --scopes my-team
comb run --saved "Handbook Helper" "what changed this month?"
comb chat --saved "Handbook Helper"          # REPL: /agent /model /budget /forget

# observe · approve · harden
comb runs --failed                           # triage refused/ungrounded runs
comb trace <run id>                          # full tool-call autopsy for one run
comb actions && comb approve <id>            # the human-in-the-loop queue
comb promote <run id>                        # failure → permanent regression test
comb eval --suite comb-regressions.json      # gate CI on it
```

`comb run`/`chat` show each tool call live and stream a grounded, cited answer —
like a coding agent, but over your company's knowledge.

## Embed it as a library

```ts
import { Brain, runAgent } from 'open-company-brain';

const brain = await Brain.create();
await brain.ingest({ format: 'text', source: 'notes', content: '…' }, ['my-team']);

const { answer, sources } = await brain.ask('…', ['my-team']);   // grounded + cited
const result = await runAgent('summarize what is open', { scopes: ['my-team'] });
```

## Backends

No code change — set `LLM_BACKEND`:

| Backend | What | Cost |
|---|---|---|
| `mock` | deterministic, offline — zero credentials (tests & demos) | $0 |
| `local` | Ollama generation + Ollama embeddings + pgvector | **$0 / query** |
| `openai` | **bring your own key** — any OpenAI‑compatible endpoint (OpenAI, Groq, Together, OpenRouter, LM Studio, vLLM) + pgvector | your key |
| `langbase` | managed Memory + Pipes | usage |

## Connect data & agents

- **Workflows (n8n, Zapier, cron)** → the ingest webhook. See [docs/N8N.md](./docs/N8N.md) and [`examples/n8n-workflow.json`](./examples/n8n-workflow.json).
- **AI IDEs (optional)** → Comb can *also* expose its brain over MCP (`comb mcp`). See [docs/MCP.md](./docs/MCP.md).

## HTTP API (selected)

```
POST /api/ingest                { format, content, source?, scope? }   data in (auth-gated)
POST /api/ask                   { question }                           grounded answer + sources
GET  /api/health-check          attention agent (what needs follow-up)
GET/POST /api/fanout/agents     reaction agents (run on each ingest)
POST /api/actions/propose       { title, instruction, query }          human-approved action
```

## Development

```bash
npm test          # vitest (176 tests, hermetic mock mode)
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run build     # → dist/
```

## Roadmap

Shipped: governed kernel · universal ingest · **calibrated cite‑or‑refuse (grounding
floor decided in code)** · access scopes (enforced at read AND write) · event‑driven
fan‑out · human‑approved actions with a **durable approval queue** + **L2 policy
auto‑approve (rate‑capped)** · library export · **MCP host** · **bring‑any‑agent
harness** · **prompt‑to‑agent (`comb new`)** + wizard · per‑agent **memory with
poisoning hygiene** · **token budgets · dynamic context window · response caching ·
retries/keep‑alive** · **agentic evals + LLM judge + prod→eval promote loop** ·
**run traces** · four backends (mock · local · **any OpenAI‑compatible key** · Langbase).

Next: web dashboard (maintenance · analytics · brain graph) · structured JSON
output for automation platforms · delivery providers (Slack/email) · resumable
runs · streaming agent loop.

## Documentation

- [docs/AGENTIC_OS.md](./docs/AGENTIC_OS.md) — architecture & research
- [docs/GETTING_STARTED.md](./docs/GETTING_STARTED.md) — full setup
- [docs/N8N.md](./docs/N8N.md) · [docs/MCP.md](./docs/MCP.md) — connectors
- [CHANGELOG.md](./CHANGELOG.md)

## License

MIT — see [LICENSE](./LICENSE).
