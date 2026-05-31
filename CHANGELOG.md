# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
semantic versioning.

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
- Test suite grown to **56 tests**; typecheck clean.

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
- HTTP API, zero-setup demo page, Docker, and a full study playbook (`docs/`).
- 14-test suite covering templating, graph, access filtering, and end-to-end seams.

### Scope held for later (documented in ARCHITECTURE.md)
- Autonomous write-actions (human-in-loop, idempotency, audit log).
- Apache AGE / Neo4j graph backends.
- LLM relation enrichment.
