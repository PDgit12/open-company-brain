# Architecture

## The one idea

The brain is **not a new database**. It is a *recall layer* and a *graph* that sit
beside your real database. Postgres keeps the truth; Langbase Memory makes that
truth findable by meaning; the graph (built from foreign keys) makes it traversable;
agents answer only from what those two layers return.

```
 Your webapp forms ─▶ Postgres (source of truth)
                          │
                          ▼  loadSnapshot()  [src/db/datasource.ts]
                    BrainSnapshot (domain objects)
                       │                  │
        snapshotToDocuments()       buildGraph()
        [src/brain/documents.ts]    [src/graph/relationships.ts]
                       │                  │
                       ▼                  ▼
        Langbase MEMORY (recall)    FK knowledge graph
                       │                  │
                       └────────┬─────────┘
                                ▼  retrieve(query, accessScopes) + introPath()
                        grounded context block  [src/agents/prompts.ts]
                                ▼
                        Langbase PIPE / MockGenerator  [src/agents/generator.ts]
                                ▼
                        answer + cited sources  ──▶ HTTP API ──▶ your webapp
```

## Layered design (and why each seam exists)

| Layer | File | Swappable impls | Why the seam |
|---|---|---|---|
| Config / mode | `src/config.ts` | — | one place decides mock vs live |
| Data source | `src/db/datasource.ts` | Postgres / Seed | demo without a DB; prod with one |
| **Adapter** | `src/adapter/index.ts` | — | the only file you edit for *your* tables |
| Templating | `src/brain/documents.ts` | pure | records → embeddable memory docs |
| Recall | `src/brain/memory.ts` | Langbase / Mock | RAG in prod; keyword search in demo |
| Graph | `src/graph/relationships.ts` | in-memory (→ SQL/AGE) | FK traversal = warm-intro paths |
| Prompts | `src/agents/prompts.ts` | pure | the trust contract lives here |
| Generation | `src/agents/generator.ts` | Langbase Pipe / Mock | LLM in prod; deterministic in demo |
| Orchestration | `src/brain/brain.ts` | — | wires it all into `brief()` / `ask()` |
| API | `src/server/app.ts` | — | the surface your webapp calls |

## The two contracts that keep it honest

1. **The access seam.** Every metadata key (`access`, `source`, …) is defined once
   in `src/constants.ts` and imported by *both* the writer (templating) and the
   reader (retrieval). Access control is only real if both sides agree on the key.
2. **The trust contract.** Prompts forbid ungrounded claims and require citations;
   the generator returns *"I don't have that in the brain yet."* when retrieval is
   empty. There is a test asserting this refusal (`test/brain.test.ts`).

## Deliberate v0 scope

Built: ingest/template/sync, recall, FK graph, briefing + Q&A, demo, tests, Docker.

Held back on purpose (each is a known next step, not an omission):
- **Autonomous writes** — v0 is read-only; writes come later behind human approval,
  idempotency, and an audit log.
- **Apache AGE / Neo4j** — the in-memory FK graph covers pilot scale; upgrade only
  when a workflow needs deep traversal or a visual relationship map.
- **LLM relation enrichment** — optional metadata tagging; add when retrieval alone
  underperforms. Kept out so no edge is ever an AI guess in v0.

## Upgrade paths

- **Scale of recall** → already on Langbase Memory in live mode; nothing to change.
- **Scale of graph** → move the traversals in `relationships.ts` into Postgres
  recursive CTEs or Apache AGE; the public functions stay identical.
- **Real auth** → replace the single demo scope in `server/app.ts` with the caller's
  real access scopes per request; the retrieval filter already honours them.
