# Connect a workflow (n8n) — the data driver

Open Brain's universal data-in path is one webhook: `POST /api/ingest`. Anything
that can make an HTTP request — n8n, Zapier, Make, a cron job, your app — can feed
the brain in real time. Each record that lands becomes scoped, embedded, cited,
retrievable knowledge **and** triggers your fan-out agents.

## 1. Run Open Brain

```bash
docker compose up -d          # pgvector (real, shared store)
# .env: LLM_BACKEND=local  VECTOR_DATABASE_URL=postgres://brain:brain@localhost:5433/company_brain
# .env: INGEST_API_KEY=choose-a-secret   INGEST_SCOPES=my-team
npm run demo                  # http://localhost:4000
```

`INGEST_API_KEY` makes the write path require auth (recommended for any shared
brain). The authenticated caller is granted `INGEST_SCOPES`.

## 2. Import the example workflow

In n8n: **Workflows → Import from File →** [`examples/n8n-workflow.json`](../examples/n8n-workflow.json).
It's a Manual Trigger → HTTP Request that POSTs to `/api/ingest`.

Then:

- **URL** — if n8n runs in Docker and Open Brain runs on your host, use
  `http://host.docker.internal:4000/api/ingest` (already set in the example).
  Same host without Docker: `http://localhost:4000/api/ingest`.
- **Authorization** — set the header to `Bearer <your INGEST_API_KEY>` (or remove
  it if the brain runs open/local with no key).
- **Body** — the JSON the brain expects:

```json
{ "format": "text", "source": "n8n", "scope": "my-team", "content": "…the data…" }
```

`format` is `text` | `csv` | `json`. `source` is the provenance label shown on
citations. `scope` must be one the key is allowed to write (its `INGEST_SCOPES`).

## 3. Wire it to your real source

Replace the Manual Trigger with whatever your workflow already does — a webhook
trigger, a database/Sheets row, an email, a CRM event — and map that data into the
HTTP node's `content`. Every run pushes a record into the brain.

## 4. See it work

- **Dashboard → Connect data** shows the live counts.
- **Dashboard → Ask** answers grounded on the new data, with citations.
- **Dashboard → Fan-out** — add a reaction agent (e.g. "extract action items")
  and it runs automatically on every record n8n pushes.
- **MCP** — the same data is instantly searchable from your AI agent IDE
  (see [MCP.md](./MCP.md)).

That's the whole loop: **your workflow feeds the brain → agents act on it → you
read the cited results anywhere.**
