<div align="center">

# Comb

### The model-free company brain your AI plugs into over MCP.

Give your AI tool (Claude, Cursor, Copilot) one **governed, cited, scope-safe** memory of
what your company knows — so it answers from your real docs **or refuses**, never invents.
Comb runs **no model of its own**: your AI brings the intelligence, Comb owns the data,
the access rules, the refusal, and the audit trail.

[![npm](https://img.shields.io/npm/v/open-company-brain.svg)](https://www.npmjs.com/package/open-company-brain)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](./tsconfig.json)
[![tests](https://img.shields.io/badge/tests-279%20passing-brightgreen.svg)](#development)
[![model-free](https://img.shields.io/badge/model--free-%240%2Fquery-brightgreen.svg)](#backends)
[![status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](#status)

</div>

---

## The problem

A company's knowledge is scattered across docs, PDFs, Word files, Slack, and people's heads.
Ask an AI "what's our refund policy?" and it guesses, or you paste the doc in every time — and
every teammate's AI gives a different answer. There is no single, current, trusted source the
AI can pull from, and nothing stops it from making an answer up.

**Comb is that source.** Scope-gated (Team A can't read Team B), kept current, and it **refuses
when it doesn't know** instead of hallucinating.

---

## Why Comb

Most tools in this space are either enterprise search you can't self-host or a thin RAG wrapper
that still makes things up. Comb is different on three axes that matter for real work:

- **Governed, not just retrieved.** Access scopes are enforced on every read, every action is
  human-approved and audited, and answers are cited or refused — never invented.
- **Model-free and self-hosted.** Comb runs no model of its own; your AI tool brings the
  intelligence over MCP. The default is keyword retrieval over a single file — $0/query, no database.
- **It compounds.** Every recorded outcome re-ranks what the brain trusts, so answers get better
  with use instead of going stale.

Comb is built for engineering and ops teams running AI agents on their own knowledge, where the
answers need to be right and accountable, not just fluent. If you only want to ask a single file a
question, your AI tool already does that — Comb earns its place when many people and agents need
the same trusted, current knowledge.

---

## Quickstart — no model, no database, no Docker

```bash
npm i -g open-company-brain          # installs the `comb` command
comb install claude                  # wire Comb into Claude / Cursor / VS Code as an MCP server
comb ingest ./company-docs/          # real files: .docx .pdf .md(OKF) .txt .csv .json
```

Then, in your AI tool (over MCP):

> *"search the brain — what does the handbook say about refunds?"*

Your agent answers from cited records, or refuses. **Comb runs no model** — retrieval is
keyword-based and your AI host does the thinking. ($0/query, nothing to configure.)

---

## What it gives your agent — 17 governed MCP tools

| Group | Tools |
|---|---|
| **Read** | `search_brain`, `ask_brain`, `find_skill`, `list_sources`, `list_intents` |
| **Write** | `ingest`, `record_fact`, `record_skill` |
| **Act** | `propose_action`, `submit_action` — you draft, Comb governs approval → execute → **audit** |
| **Prove + learn** | `query_runs`, `declare_intent`, `list_divergence_candidates`, `record_outcome` |
| **GTM** | `gtm_research_prospect`, `gtm_draft_outreach` |

### Connect over MCP

```jsonc
// Claude Desktop / Cursor MCP config (or just run `comb install claude`)
{ "mcpServers": { "comb": {
  "command": "comb", "args": ["mcp"],
  "env": { "LLM_BACKEND": "modelfree", "COMB_RETRIEVAL": "keyword",
           "MCP_PRINCIPAL": "you", "MCP_SCOPES": "default-team" } } } }
```

---

## Real files in, Google OKF in and out

Comb ingests the formats companies actually use:

```bash
comb ingest ./docs/                  # .docx (Word), .pdf, .md, .txt, .csv, .json
```

A corrupt or unreadable file is **skipped**, not fatal to the batch.

It also speaks **[Google's Open Knowledge Format (OKF, 2026)](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing)** —
a directory of markdown concept files with YAML frontmatter:

```bash
comb ingest ./okf-bundle/            # concept type/title/tags become structured, searchable
comb export --out ./okf-out          # write the brain back out as a scope-gated OKF bundle
```

OKF is the curated layer; Comb adds what OKF files lack — **access scopes, cite-or-refuse,
audit, and the learning loop.**

---

## A GTM persona over the brain

What a static prompt file can't do: query a corpus past the context window, enforce scopes,
and refuse when ungrounded. Two MCP tools turn the brain into a grounded GTM agent:

```
gtm_research_prospect { name:"Jane Doe", company:"Acme", role:"CTO" }
  → a dossier built ONLY from cited brain records — or nothing
gtm_draft_outreach   { name:"Jane Doe", company:"Acme", angle:"cut their API test maintenance" }
  → a personalized email grounded in cited records; refuses if there's no grounding
```

---

## Why this is not a RAG wrapper

A RAG wrapper is four steps: ingest → embed → retrieve → hand to an LLM. Comb keeps that
spine and adds the systems work a wrapper skips — all built and tested today:

| Concern | RAG wrapper | Comb |
|---|---|---|
| Who can read a record | nothing | access scopes asserted on **every** read |
| Hallucination control | hope the model cites | **deterministic refusal in code** before generation |
| Real-file ingest | usually .txt/.md | .docx · .pdf · OKF · .csv · .json |
| Doing things | none | propose → approve → execute → **audit** |
| Getting better | static | `record_outcome` → reward → re-ranks retrieval |
| Proof it works | none | behavioural eval asserted in CI |

The model is the easy, swappable part. The governance, refusal, audit, and loop are the product.

---

## Backends

No code change — set `LLM_BACKEND`. **You do not need a vector database**; the default is a
single JSON file.

| Backend | Recall | Generation | Needs | Cost |
|---|---|---|---|---|
| `modelfree` *(default)* | keyword | your AI host, over MCP | nothing | **$0/query** |
| `local` | pgvector / file-vector | Ollama | Ollama (+ optional Postgres) | $0/query |
| `openai` | pgvector / file-vector | any OpenAI-compatible key | your key | your key |
| `langbase` | managed | managed | Langbase key | usage |

---

## CLI

```bash
comb install <client>       # wire Comb into Claude/Cursor/VS Code as MCP
comb ingest <file|folder|url> [--source name] [--scope s] [--replace]
comb export [--out dir] [--scope a,b]   # write the brain out as an OKF bundle
comb mcp                    # run the MCP server (stdio)
comb doctor                 # which backend is live, what's missing
comb reset [--all] [--yes]  # clean slate (wipes the real knowledge stores)
comb eval                   # run the behavioural eval suite
```

### Keeping data fresh (URLs & feeds)

Ingest accepts a URL, and a snapshot is stored — it isn't a live link. To refresh
data that changes over time, **re-ingest with `--replace`**: it wipes that source's
old records first, so an updated page/feed replaces its snapshot cleanly instead of
piling stale copies beside it.

```bash
comb ingest https://example.com/pricing --source pricing --replace
```

For automation, schedule the re-ingest (cron / n8n / Zapier) against the same source,
or POST to the ingest webhook (`POST /api/ingest`). Comb stores what you give it; it
doesn't poll URLs on its own.

---

## Embed it as a library

```ts
import { Brain } from 'open-company-brain';

const brain = await Brain.create();
await brain.ingest({ format: 'text', source: 'notes', content: '…' }, ['my-team']);
const { answer, sources } = await brain.ask('…', ['my-team']);   // grounded + cited, or refuses
```

---

## Development

```bash
git clone https://github.com/PDgit12/open-company-brain.git
cd open-company-brain && npm install
npm test && npm run typecheck && npm run lint && npm run build
```

## License

[MIT](./LICENSE)
