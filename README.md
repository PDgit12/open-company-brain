# Company Brain

> An open-source template for turning any organization's scattered records into a
> **governed, grounded AI brain** — semantic recall + a foreign-key knowledge graph +
> cited briefing & Q&A agents — deployable serverless on [Langbase](https://langbase.com).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](./tsconfig.json)
[![Runs with zero setup](https://img.shields.io/badge/demo-zero%20setup-brightgreen.svg)](#quick-start-mock-mode-zero-setup)

Bring your own data, your own domain, your own deployment. Company Brain is built to
be **forked and adapted**: swap the example domain for yours by editing two files,
point it at your database, add your Langbase key, and ship.

> **The trust contract is the product:** every answer cites the records it came from,
> and the brain refuses to answer when it has no grounding.

---

## Why this exists

Most teams' knowledge is scattered across a database, spreadsheets, chat logs, and
people's heads. Generic "chat with your docs" tools either hallucinate or ignore who
is allowed to see what. Company Brain is a small, auditable, **self-hostable** core
that does the trustworthy version: grounded answers, citations, access scoping, and a
real (foreign-key) knowledge graph — with nothing you can't read in an afternoon.

The repo ships with a generic **relationship/CRM** example domain (companies,
contacts, engagements, programs). That's just the reference domain — swap it for
yours; see *Make it yours* below.

## What you get

- **Recall layer** — Langbase Memory (RAG) in production; an in-memory keyword engine
  for zero-setup demos and tests.
- **Knowledge graph** — built from your foreign keys (no AI-invented edges); answers
  "how is X connected to Y?" with shortest-path search.
- **Two agents** — grounded **briefing** and **Q&A**, both access-scoped and cited.
- **Two run modes** — mock (no credentials) and live (Langbase + Postgres), chosen
  automatically from your `.env`.
- **A clean adapter seam** — one file maps your tables onto the model.
- **Batteries** — demo UI, HTTP API, tests, Docker, and a full study playbook.

## Get started in one command

Scaffold your own instance, add your keys, run. That's the whole framework promise —
you bring API keys; everything else is built in.

```bash
npx degit PDgit12/open-company-brain my-brain
cd my-brain && npm install
npm run init          # guided setup — paste your keys, or skip for mock mode
npm run demo          # → http://localhost:4000
```

`npm run init` writes your `.env`; `npm run doctor` reports the active mode and
what's still needed. With no keys it runs immediately in mock mode on synthetic seed
data — pick an entity → **Brief me**, ask a question, find a **relationship path**.

## Go live

```bash
cp .env.example .env
# 1) add your Langbase key:        LANGBASE_API_KEY=...
# 2) (optional) point at Postgres: DATABASE_URL=postgres://user:pass@localhost:5432/yourdb

docker compose up -d   # optional: a local Postgres
npm run seed:db        # optional: load schema + sample data
npm run sync           # build/refresh the recall layer
npm run demo
```

`/health` will report `recall=live generation=live`. **No application code changes —
only environment.**

## Make it yours (any domain, any stack)

Company Brain is a template. To adapt it to your organization:

1. **Your domain** — edit `src/domain/types.ts` to describe your entities (the example
   uses companies/contacts/engagements/programs; yours might be patients/visits, or
   clients/matters, or properties/leads).
2. **Your data** — edit `src/adapter/index.ts`: the SQL that reads your tables and the
   mappers that shape your rows. This is the *only* file you must change to use real
   data.
3. **Your access model** — entities carry an `access` scope; pass the caller's real
   scopes from your auth layer into `brain.brief/ask`.
4. **Your front end** — call the HTTP API from anything (Next.js, mobile, a Slack bot).

If you can map your tables in ten minutes, the integration is done.

## HTTP API

Read (grounded + cited, access-scoped):

| Endpoint | Body | Returns |
|---|---|---|
| `GET /health` | — | status + active mode |
| `GET /api/companies` | — | known entity names |
| `POST /api/brief` | `{ company }` | grounded briefing + sources |
| `POST /api/ask` | `{ question }` | grounded answer + sources |
| `POST /api/ask/stream` | `{ question }` | SSE token stream |
| `POST /api/intro-path` | `{ from, to }` | relationship path (graph) |
| `GET /api/health-check` | — | what needs attention (health agent) |

Write (action layer — human-approved, idempotent, audited):

| Endpoint | Body | Returns |
|---|---|---|
| `POST /api/actions/draft-email` | `{ company, goal }` | a proposed action (not executed) |
| `POST /api/actions/log-engagement` | `{ company, summary, ... }` | a proposed action |
| `POST /api/actions/:id/approve` | — | executes (idempotent) |
| `POST /api/actions/:id/reject` | `{ reason? }` | marks rejected |
| `GET /api/actions` | — | list of actions |
| `GET /api/actions/audit` | — | the audit log |

**Access scopes:** send `x-access-scopes: scopeA,scopeB`; retrieval only ever
returns chunks within those scopes.

```ts
const res = await fetch('http://localhost:4000/api/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ question: 'Which partners care about ML research?' }),
});
const { answer, sources } = await res.json();
```

## Scripts

| Command | Does |
|---|---|
| `npm run demo` | run the API + demo page |
| `npm run dev` | same, with hot reload |
| `npm run sync` | incremental rebuild of the recall layer (changed rows only) |
| `npm run sync:full` | full rebuild of the recall layer |
| `npm run eval` | run the golden behavioural eval set |
| `npm run seed:db` | load schema + sample data into Postgres |
| `npm test` | run the test suite (31 tests) |
| `npm run typecheck` | strict type check |
| `npm run build` | compile to `dist/` |

## Documentation

- [`docs/GETTING_STARTED.md`](./docs/GETTING_STARTED.md) — the 5-minute path: scaffold → keys → your data → your workflow.
- [`examples/custom-action.example.ts`](./examples/custom-action.example.ts) — copyable template for your own workflow.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the layered design and the two contracts.
- [`docs/STUDY_PLAYBOOK.md`](./docs/STUDY_PLAYBOOK.md) (+ `.docx`) — a full
  basics→mastery study guide explaining every concept and every file.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — how to set up and contribute.

## Capabilities

- **Connectors** — read from Postgres, CSV folders, or a JSON snapshot with no code
  change (`DATA_CONNECTOR=csv CONNECTOR_PATH=examples/sample-data`). The connector
  interface is the template for adding more sources.
- **Real action delivery** — approved actions go to a record-only outbox (default),
  a real **file** (`outbox/*.jsonl`), or a **webhook** — selected by env.
- **Read core** — grounded, cited briefing & Q&A; FK knowledge graph.
- **Action layer** — agents *draft* write-actions (email, log engagement); a human
  *approves*; execution is **idempotent** and every step is **audited**. Email is
  queued to an outbox by default (never silently sent).
- **Multi-scope access control** — per-request scopes; cross-scope records stay
  hidden (a company document never leaks a more-restricted child).
- **Incremental sync** — only changed rows re-embed, tracked by a watermark.
- **Graph backends** — in-memory (default) or a Postgres recursive-CTE backend;
  Apache AGE / Neo4j drop in behind the same interface.
- **Relation-enrichment** — deterministic theme tagging (LLM-swappable).
- **Health agent** — flags stale relationships and open items.
- **Streaming, observability, evals** — SSE answers, structured request logs, and a
  golden eval set wired into CI.

Still intentionally deferred: real email/calendar delivery providers, a visual
relationship-map UI, and live LLM enrichment. See `ARCHITECTURE.md`.

> **Not a visual workflow builder.** Company Brain is code-first: a "workflow" is a
> small, typed *action recipe* (a prompt + an executor) a developer adds in a few
> lines — grounded, governed, and audited by the framework. It is deliberately
> **not** an n8n-style drag-and-drop canvas; it gives opinionated, safe agentic
> primitives instead of a blank automation board.

## Contributing

PRs welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) and
[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Good first issues: new data-source
adapters, additional example domains, a recursive-CTE graph backend.

## License

[MIT](./LICENSE). All sample data is synthetic.
