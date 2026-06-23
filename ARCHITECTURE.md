# Architecture

> **Honest scope:** this describes what is **shipped and tested today** (274 tests,
> typecheck/lint/build green). Future/optional work is in [§9 Roadmap](#9-roadmap),
> kept separate so nothing here is aspirational.

Comb is a **governed, model-free knowledge substrate** that AI agents plug into over
MCP. It runs no model of its own — your AI tool (Claude, Cursor, Copilot) brings the
intelligence; Comb owns the data, the access rules, the refusal decision, the action
governance, and the learning loop.

---

## 1. The whole thing in four parts

```
1. MCP server        src/mcp/server.ts      → 17 governed tools your AI calls
2. Brain             src/brain/*            → ingest · search · grounding/refuse
3. Store ladder      src/brain/memory.ts    → ONE seam, 5 backends (see §4)
4. Loop              src/actions · feedback · eval · intents · divergence
                                            → propose→approve→execute→audit, learn from outcomes
```

That's it. The code is a clean ladder behind one `MemoryStore` seam — not a maze.

---

## 2. Why this is not a RAG wrapper

A RAG wrapper is four steps: ingest → embed → retrieve → hand to an LLM. Comb keeps
that spine but adds the systems work a wrapper skips — all **built and tested today**:

| Concern | RAG wrapper | Comb | Where |
|---|---|---|---|
| Who can read a record | nothing | access scopes asserted on **every** read | `assertScoped`, `src/brain/memory.ts` |
| Hallucination control | hope the model cites | **deterministic refusal in code** before generation, calibrated per embedding model | `src/brain/grounding.ts` |
| Real-file ingest | usually .txt/.md | .docx · .pdf · .md(OKF) · .txt · .csv · .json | `extractText`, `src/harness/ingest-files.ts` |
| Doing things | none | propose → approve → execute → **audit** | `src/actions/*` |
| Getting better | static | `record_outcome` → reward → re-rank + grow eval set | `src/feedback/*` |
| Proof it works | none | behavioural eval asserted in CI | `src/eval/*`, `test/` |

The model is the easy, swappable part. The governance, refusal, audit, and loop are the product.

---

## 3. Request flows

### Ingest (data in)
```
file/folder/url ─▶ extractText            src/harness/ingest-files.ts
                     · .docx → mammoth   · .pdf → pdf-parse
                     · .md/.txt → OKF frontmatter folded into searchable text
                     · .csv/.json → as-is   · a bad file is skipped, not fatal
                ─▶ Brain.ingest(content, source, scope)   src/brain/brain.ts
                ─▶ MemoryStore.upsert (scoped)            src/brain/memory.ts
```

### Query / act (the MCP product)
```
your AI tool ─MCP─▶ comb mcp server   src/mcp/server.ts  (17 tools)
  search_brain  ─▶ Brain.search ─▶ scope-filtered retrieval ─▶ ServingOptimizer ─▶ cited records
  ask_brain     ─▶ Brain.ask    ─▶ grounding gate ─▶ (model) answer-or-refuse, cited
  gtm_*         ─▶ Brain.search / Brain.draft  → grounded persona tools (cite-or-refuse)
  propose_action─▶ ActionService ─▶ approval queue ─▶ execute ─▶ audit
  record_outcome─▶ feedback ─▶ reward ─▶ re-rank + grow eval set
```

On the **model-free default** Comb generates nothing: `search_brain` returns cited
records and your host agent writes the answer. `ask_brain`/`comb run` honestly report
"no model" rather than fabricate (`RefusingGenerator`, `src/agents/generator.ts`).

---

## 4. Store ladder (one seam, pick by config — no DB required)

`createMemoryStore()` in `src/brain/memory.ts` resolves exactly one:

| Mode | Store | Needs | Cost |
|---|---|---|---|
| **`retrieval=keyword` (DEFAULT)** | `keyword-docs.json` | **nothing** — a file | $0 |
| `local`/`openai`, no DB | `vectors.json` (file vector) | a local embedder | $0 |
| `local`/`openai` + Postgres | pgvector | Postgres | infra |
| `local`/`openai` + AWS | S3 Vectors | AWS creds | AWS |
| `langbase` | managed | Langbase key | usage |
| tests | in-memory mock | nothing | — |

**You do not need a vector DB.** The default is a single JSON file. Vectors/Postgres/S3
are scale upgrades behind the same contract — opt in only when a big corpus demands it.

---

## 5. The grounding decision (anti-hallucination core)

Vector retrieval never returns "nothing" — it returns nearest neighbours even for an
unanswerable query. So "is this grounding enough?" is a **deterministic, pre-generation
decision in code** (`src/brain/grounding.ts`): refuse unless the best score clears a
floor **plus** a thin-grounding margin. The floor is **calibrated per embedding model**
(`comb calibrate`), because different embedders have different score distributions.
Cite-or-refuse holds on the keyword default *and* the vector path.

---

## 6. The closed loop (why it compounds)

Most agents stop at *execute* and forget. Comb records the **real outcome** of an
approved action (`record_outcome`: replied · converted · ignored · error · reverted),
feeds it into a reward that re-ranks retrieval, and turns production failures into
permanent regression cases (`comb promote`) that gate CI (`comb eval`).

---

## 7. OKF — Google Open Knowledge Format (2026)

OKF (Google Cloud, June 2026) is a vendor-neutral spec: a directory of markdown
"concept" files with YAML frontmatter (`type` required; `title`/`description`/`tags`/…
optional). It is **complementary to retrieval, not a replacement** — OKF is the curated,
stable knowledge layer; retrieval handles the large corpus.

Comb ingests OKF natively: `extractText` folds a concept's frontmatter into searchable
text (`foldFrontmatter`), so `type`/`title`/`tags` are retrievable instead of dumped as
raw YAML. `comb ingest ./okf-bundle/` just works. What OKF files lack — access scopes,
cite-or-refuse, audit, the outcome loop — is exactly what Comb adds on top.

---

## 8. Integrity guarantees (asserted in CI)

- **Scope isolation** — a `leadership` record is invisible to a `default-team` caller.
- **No demo-data leak** — a real (`comb install`) brain starts empty; holds only what
  you ingest (`test/no-seed-leak.test.ts`).
- **Reset wipes knowledge** — `comb reset` clears the real stores (`test/reset-targets.test.ts`).
- **Resilient ingest** — a corrupt file is skipped, the batch survives.
- **274 tests** · typecheck · lint · build green.

---

## 9. Roadmap (NOT shipped — kept separate on purpose)

These are intentional next steps, not current behaviour:

- **Semantic recall by default** — today vectors are opt-in; keyword is the default.
- **S3 Vectors** — wired but exercised only with AWS creds.
- **OKF export** — Comb ingests OKF; emitting the brain *as* an OKF bundle is next.
- **Dashboard / observability UI** — CLI + HTTP API exist; no UI yet.
- **Auto skill-mining** — skills are recorded explicitly today; auto-induction later.
- **Production hardening** — write-path auth is open-by-default for local dev; a real
  deployment must set `INGEST_API_KEY`. Status: **alpha**, not battle-tested.
