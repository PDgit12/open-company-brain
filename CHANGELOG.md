# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
semantic versioning.

## [0.5.0] — 2026-06-11

The production-trust release: refusal decided in code, agents built from one
prompt, autonomy with governance, and a quality plane that ratchets.

### Added — trust kernel
- **Grounding floor**: `assessGrounding` gates every generation — thin retrieval
  → deterministic refusal BEFORE the model runs (fixes the silent cite-or-refuse
  inversion on the vector path). Refusals carry no sources and cost ~0 tokens.
- **Per-model calibration**: `comb calibrate --labels file.json` places the floor
  from labeled answerable/unanswerable queries (midpoint-candidate sweep), stored
  per embedding model.
- **Write-boundary scope guard**: storing a document without an access scope now
  fails loudly in every memory store.

### Added — agent runtime
- **`comb new "<wish>"`**: one prompt drafts a complete agent (definition +
  starter calibration labels) via a direct model call, with a deterministic
  fallback. `comb create` (wizard + CI flags), `comb agents`, `comb forget`.
- **Per-agent conversation memory** (file → Postgres) with **poisoning hygiene**:
  only grounded exchanges are stored; only grounded turns replay; legacy rows
  auto-invalidated (PG migrates in place).
- **Saved-agent runs**: `comb run --saved <name>` / `comb chat --saved`, with
  in-chat `/agent`, `/model` (hot-swap, local), `/budget`, `/forget`, `/help`.
- **`comb ingest <file>`**: feed the brain from the CLI, no server needed.

### Added — model plane
- **BYO key**: new `openai` backend — any OpenAI-compatible endpoint (OpenAI,
  Groq, Together, OpenRouter, LM Studio, vLLM) for generation + embeddings.
- **Dynamic context window**: resolved per model (Ollama introspection → known-
  models table → safe default); memory packing derives from it.
- **Tokenizer seam** (heuristic default, optional exact BPE), per-scope **token
  budgets** (refuse on exhaustion), **response cache** (TTL, deterministic runs),
  **retries/timeouts** with backoff on all model calls, **Ollama keep_alive**,
  **tool-result clamping** in the agent loop.

### Added — quality plane
- **Agentic evals**: `comb eval [--suite file.json]` asserts behaviour over the
  step trace (cites/refuses/uses_tool/budget/scope) hermetically, plus a live
  LLM-judge + multi-turn memory layer that skips (not fails) on mock.
- **Run traces**: every run persists steps/tokens/latency — `comb runs [--failed]`,
  `comb trace <id>`; **prod→eval loop**: `comb promote <run id>` turns a flagged
  run into a permanent regression case.

### Added — action plane
- **Durable approval queue** (file-backed; survives restarts) + CLI surface:
  `comb actions`, `comb approve <id>`, `comb reject <id>` — cross-process with
  the server. **L2 autonomy**: `ACTION_AUTO_APPROVE=on` lets policy approve
  grounded proposals under an hourly rate cap, audited as policy (not human);
  grounding is checked before policy ever sees a proposal.

## [0.4.0] — 2026-06-07

### Changed — reframed into a universal agentic OS (breaking)
- **Removed the CRM domain entirely.** The brain is now domain-agnostic: it boots
  empty and is fed only via `ingest`. Deleted the companies/contacts/engagements
  model, the knowledge graph, the adapter/datasource/json-snapshot connectors,
  `sync`, the CRM seed + `db/schema.sql`, and `brief` / `intro-path` /
  `companyNames`. A generic demo seed keeps mock mode + the dashboard non-empty.
- **Universal ingestion** is the single data-in path (text/CSV/JSON, no
  privileged schema) with deterministic theme enrichment on every record.
- **Generalized the action layer** to `propose({title,instruction,query})` →
  approve → deliver (outbox/file/webhook); dropped the email/engagement specifics.

### Added — three shells over one governed kernel
- **Library export** — `import { Brain, createApp } from 'open-company-brain'`
  (`exports`/`main`/`types`), so the OS is embeddable, not just runnable.
- **Event-driven fan-out** — reaction agents that run automatically over each new
  ingest via `Brain.ingest` (so the library AND the HTTP route both get it);
  empty by default (cost guard); scope-gated. Routes: `/api/fanout/*`.
- **MCP server** (`comb mcp`, `npm run mcp`) — the agent shell: stdio
  server exposing `search_brain`, `ask_brain`, `ingest`, `list_sources` to any
  MCP host (Claude Code/Desktop, Cursor). `Brain.search()` added for pure
  scoped retrieval.
- **Ingest webhook auth + rate limit** — `INGEST_API_KEY` (Bearer/x-api-key)
  grants `INGEST_SCOPES`, with a per-minute limiter; open when unset (dev).
- **Dashboard reframed** to the universal model with a Fan-out tab and an n8n
  webhook card; **n8n example** (`examples/n8n-workflow.json`) + `docs/N8N.md` +
  `docs/MCP.md`.
- **Real eslint flat config** so `npm run lint` is a real gate (passes clean).

### Verified
- 78 tests (75 pass, 3 skipped); typecheck + lint clean.
- Real end-to-end on the local backend (Ollama + pgvector): real embeddings,
  real generation, cite-or-refuse, fan-out, and all three shells sharing one
  pgvector store (HTTP ingest → MCP `search_brain` reads it).

## [0.3.0] — 2026-05-30

### Added — self-improvement loop + a fully-local backend
- **Fully-local backend** (`LLM_BACKEND=local`) — $0 per query, self-hosted: local
  generation (`OllamaGenerator`), local embeddings (`OllamaEmbedder`), and a
  Postgres + **pgvector** recall store (`PgVectorMemoryStore`), all behind the
  existing swappable seams. One-command `npm run setup:local`.
- **Feedback substrate** (`src/feedback/feedback.ts`) — every thumbs up/down and
  action approve/reject becomes a scope-gated, reward-normalized `FeedbackEvent`.
  `POST /api/feedback` records verdicts.
- **Few-shot learning loop** — `ask()` injects approved past answers (scope-gated)
  as exemplars so style/rigor compounds with usage.
- **Retrieval reranker** (`rerankByReward`) — boosts sources humans found useful,
  demotes rejected ones (bounded, no-op on a cold brain).
- **Auto-grown eval set** — rejected refusals become `has_sources` regression
  candidates, surfaced as a scope-gated review queue at `GET /api/eval/candidates`.
- **API resilience** — `asyncRoute` + a central error handler return a safe 500
  instead of crashing the process when a provider is down.
- **`RETRIEVAL_MIN_SCORE`** similarity floor preserves cite-or-refuse under vector
  search (which always returns nearest neighbours).
- **Web agent console** (`public/index.html`) — a bento dashboard to ask/brief/scan,
  see citations, give feedback, approve/reject actions, and review eval candidates.
- **No-code custom agents** — define an agent from just a prompt in the dashboard,
  run it live (grounded + cited via `/api/agents/run`), and save it; definitions
  persist in Postgres (`PgCustomAgentStore`) or in-memory in mock mode.
- Test suite grown to **65 tests**; typecheck clean.

## [0.2.0] — 2026-05-30

### Added — Tiers 1–3
- **Action layer** (`src/actions/*`) — agents propose write-actions (draft email,
  log engagement); human approval required; idempotent execution; full audit log.
  Email is queued to an outbox, never silently sent.
- **Multi-scope access control** — per-request `x-access-scopes`; company documents
  no longer leak more-restricted child records (security fix surfaced by the eval).
- **Incremental sync** — only changed rows re-embed, tracked by a watermark
  (`npm run sync`, `npm run sync:full`).
- **Postgres recursive-CTE graph backend** behind the same graph interface.
- **Relation-enrichment** — deterministic theme tagging on documents (LLM-swappable).
- **Relationship-health agent** — flags stale relationships / open actions.
- **Streaming** — SSE answer endpoint.
- **Observability + evals** — structured request logging; golden eval set
  (`npm run eval`) also asserted in tests.
- Test suite grown to 31 tests; CI runs typecheck + tests + build.

## [0.1.0] — 2026-05-30

Initial open-source release.

### Added
- **Two run modes** — mock (zero-credential, in-memory) and live (Langbase + Postgres),
  selected automatically from environment variables.
- **Recall layer** (`MemoryStore`) with Langbase Memory and in-memory mock implementations.
- **Knowledge graph** built from foreign keys, with shortest-path ("intro path") search.
- **Two agents** — grounded, cited **briefing** and **Q&A**, both access-scoped.
- **Trust contract** — cite-or-refuse, enforced in prompts and asserted by tests.
- **Adapter seam** (`src/adapter/index.ts`) — the single file to map your tables.
- **Example domain** — a generic relationship/CRM model with synthetic seed data.
- HTTP API, zero-setup demo page, Docker, and developer docs (`docs/`).
- 14-test suite covering templating, graph, access filtering, and end-to-end seams.

### Scope held for later (documented in ARCHITECTURE.md)
- Autonomous write-actions (human-in-loop, idempotency, audit log).
- Apache AGE / Neo4j graph backends.
- LLM relation enrichment.
