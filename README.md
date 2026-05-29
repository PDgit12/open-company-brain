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

## Quick start (mock mode, zero setup)

```bash
npm install
npm run demo          # → http://localhost:4000
```

Open the page: pick an entity → **Brief me**, ask a question, find a **relationship
path**. No API key, no database — it runs on synthetic seed data.

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

| Endpoint | Body | Returns |
|---|---|---|
| `GET /health` | — | status + active mode |
| `GET /api/companies` | — | known entity names |
| `POST /api/brief` | `{ company }` | grounded briefing + sources |
| `POST /api/ask` | `{ question }` | grounded answer + sources |
| `POST /api/intro-path` | `{ from, to }` | relationship path |

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
| `npm run sync` | (re)build the recall layer from the data source |
| `npm run seed:db` | load schema + sample data into Postgres |
| `npm test` | run the test suite (14 tests) |
| `npm run typecheck` | strict type check |
| `npm run build` | compile to `dist/` |

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the layered design and the two contracts.
- [`docs/STUDY_PLAYBOOK.md`](./docs/STUDY_PLAYBOOK.md) (+ `.docx`) — a full
  basics→mastery study guide explaining every concept and every file.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — how to set up and contribute.

## Scope

v0 is deliberately the trustworthy read-only core. Held back on purpose (and
documented as next steps): autonomous write-actions, the Apache AGE / Neo4j graph
upgrade, and LLM relation-enrichment. See `ARCHITECTURE.md`.

## Contributing

PRs welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) and
[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Good first issues: new data-source
adapters, additional example domains, a recursive-CTE graph backend.

## License

[MIT](./LICENSE). All sample data is synthetic.
