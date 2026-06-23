<div align="center">

# 🐝 Comb

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

## Value proposition

> **For** teams whose AI assistants keep guessing about how the company actually works,
> **Comb** is a model-free, self-hosted knowledge layer any AI plugs into over MCP.
> **It** turns scattered docs into one governed source your agents answer from — with
> citations, access scopes, a refusal when ungrounded, and an audit trail on every action.
> **Unlike** enterprise search suites, you self-host it and it runs **no model** ($0/query);
> **unlike** a RAG wrapper, it enforces who-sees-what, refuses instead of hallucinating, and
> governs real actions — and it **compounds**: every recorded outcome re-ranks what it trusts.

**In one line:** the trusted, governed memory that makes your AI's answers about your company
**correct, consistent, and accountable — or honestly absent.**

**Who it's for:** engineering and ops teams running AI agents on their own knowledge who need
the answers to be *right and governed*, not just fluent. **Who it's not for:** a single person
who just wants to ask one file a question — your AI tool already does that.

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
comb ingest <file|folder|url>   # .docx .pdf .md .txt .csv .json (+ OKF)
comb export [--out dir] [--scope a,b]   # write the brain out as an OKF bundle
comb mcp                    # run the MCP server (stdio)
comb doctor                 # which backend is live, what's missing
comb reset [--all] [--yes]  # clean slate (wipes the real knowledge stores)
comb eval                   # run the behavioural eval suite
```

---

## Embed it as a library

```ts
import { Brain } from 'open-company-brain';

const brain = await Brain.create();
await brain.ingest({ format: 'text', source: 'notes', content: '…' }, ['my-team']);
const { answer, sources } = await brain.ask('…', ['my-team']);   // grounded + cited, or refuses
```

---

## Proof, not claims

- **279 tests pass** (typecheck + lint + build green).
- **Cite-or-refuse, asserted in CI:** the brain refuses an unseen topic, answers across sources,
  and **hides leadership-only records from a default-team caller** — scope isolation on every read.
- **No demo-data leak:** a guard test proves a real `comb install` brain starts empty — it holds
  only what you ingest.
- **Resilient ingest** and **scope-aware record ids** (the same text in two scopes stays two records),
  both regression-tested.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for how it's built and what's shipped vs roadmap.

---

## Status

**Alpha.** The engineering is real and tested; the product is early. Not yet battle-tested for
production — the write-path API is open by default for local dev (set `INGEST_API_KEY` for any
shared deployment). Architected for production; not claiming production-ready.

## Development

```bash
git clone https://github.com/PDgit12/open-company-brain.git
cd open-company-brain && npm install
npm test && npm run typecheck && npm run lint && npm run build
```

## License

[MIT](./LICENSE)
