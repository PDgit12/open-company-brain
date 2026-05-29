# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
semantic versioning.

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
