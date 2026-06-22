# Comb — The Final Architecture (locked)

> THE design authority. Code converges toward this; when code and this document
> disagree, the document wins. This is the model-free, MCP-first, knitbrain-
> pattern restructuring of Comb. Everything before this version is superseded.

---

## 1. Value proposition (locked — one statement)

**Comb is the company brain that powers a closed loop.** It pulls a company's
scattered know-how into a living, governed brain — *what is true* (facts) and
*how work is actually done* (skills) — keeps it current, and runs the loop on
top: monitor what's happening, compare it to what should be happening, adjust
through approved actions. Any AI the company already uses plugs in over MCP and
becomes legible, accountable, and able to do the work safely.

- **Blomfield's "company brain"** = our substrate (facts + skills, the living map).
- **Hu's "AI OS / closed loop"** = what runs on it (monitor → compare → adjust → self-improve).
- **Neither sells alone.** Brain without loop = search (commodity). Loop without
  brain = noise. The coupling, with governance at every joint, is the product.
- **What we sell** = the loop's outcome on one painful workflow, priced on
  provable savings (the Gong lesson). The brain is *why ours works* where ~95%
  of enterprise AI pilots fail on missing context.

## 2. Two principles everything derives from

**P1 — Intelligence is rented; governance is owned.** Comb runs NO model. The
connected agent (Claude/Copilot/Cursor) is the intelligence. Comb returns DATA
and governed STATE, never generated prose. This removes model ops, model cost,
and the generation-privacy problem — and is the knitbrain-proven posture.

**P2 — Reliability compounds, never rented.** A scope filter, a governed
approval, a promoted eval, a recorded skill — each is owned, durable, and
accrues per company. The model improves under us with zero changes; what we own
(the brain, the loop state, the audit history) is what no model release ships.

## 3. The locked posture: model-free, MCP-first (the knitbrain proof)

knitbrain (v0.2.1) is a company-knowledge brain over MCP whose only deps are
the MCP SDK + a parser + a tokenizer — **no embeddings, no vector DB, no LLM.**
It serves a structured knowledge graph + trigger-matched skills; the host agent
(Claude Code) does all reasoning. Comb adopts this exactly, generalized from
code to company:

- **No embeddings ⇒ retrieval is KEYWORD + structured** (model-free,
  file-persistent). The host's smart model does query expansion + synthesis.
- **The host does the structuring** that code gets free from syntax: at ingest,
  the agent reads an artifact and records structured facts + skills through
  governed MCP tools. Comb stores and serves; it never extracts with a model.
- **Vector/semantic recall is an OPT-IN upgrade** for deployments that accept an
  embedder (local or a key) — same store contract, swapped behind the seam.

## 4. The architecture (layers, top to bottom)

```
HOST AGENT (Claude/Copilot/Cursor) — ALL reasoning · structuring · generation
   │  MCP: read · write · act · prove   (the product's front door)
   ▼
┌─ CCR SERVING OPTIMIZER (knitbrain's lesson) ──────────────────────────────┐
│  every MCP response: COMPRESS (text/json/structured) + DEDUP against a     │
│  per-session RETRIEVAL MANIFEST (never re-send what the host has) +        │
│  CACHE-ALIGN. Rule: never make a payload larger. Minimizes the host's      │
│  tokens; the host runs cheap and fast.                                     │
├─ THE BRAIN (model-free stores — the living map) ──────────────────────────┤
│  • FACTS    keyword retrieval over scoped chunks            search_brain   │
│  • SKILLS   {name, triggers[], body, scope}  trigger-matched  find_skill   │
│             "how refunds get handled" — host records on ingest             │
│  • GRAPH    light entity/relation links (host-recorded)      (optional)    │
│  scope-filtered + audited + the grounding SIGNAL returned with results     │
├─ THE CLOSED LOOP (host reasons · Comb governs) ───────────────────────────┤
│  INGEST   host structures artifact → record_fact / record_skill           │
│  MONITOR  Comb keyword-matches new data vs Intents → CANDIDATES (no model) │
│  COMPARE  host model judges the candidate (the reasoning)                  │
│  ADJUST   host → submit_action → Comb's approval → execute → deliver       │
│  LEARN    Comb traces all → runs --failed → promote → eval gate            │
├─ GOVERNANCE (Comb-owned, model-free) ─────────────────────────────────────┤
│  scope enforcement (read + write boundary) · approval/autonomy dial ·      │
│  idempotent execution · append-only audit · per-corpus calibration signal  │
├─ PERSISTENCE LADDER ──────────────────────────────────────────────────────┘
   in-memory (tests) → JSON files .comb/ (zero-setup) → Postgres (prod)
```

## 5. The division of labor (THE crux — who does what)

| Job | Owner |
|---|---|
| Structure an artifact (extract facts/skills) | **HOST model** (via record_* tools) |
| Answer a question / synthesize | **HOST model** (over what search returns) |
| Judge whether reality diverges from intent | **HOST model** (over the candidate) |
| Draft an action body | **HOST model** (then submit_action) |
| Store / retrieve / scope knowledge | **Comb** (keyword + skills, model-free) |
| Detect divergence CANDIDATES | **Comb** (keyword overlap, model-free) |
| Govern approval · execute · deliver · audit | **Comb** |
| Optimize served context (compress/dedup/cache) | **Comb** (CCR) |
| Trace · eval · calibrate · ratchet | **Comb** |

Comb never thinks. The host always thinks. Comb makes the thinking grounded,
cheap, accountable, and safe.

## 6. The MCP surface (the four verbs)

- **READ** — `search_brain` (scoped chunks + grounding signal) · `find_skill`
  (trigger-matched "how X is done") · `list_intents`.
- **WRITE** — `ingest` (raw → refinery) · `record_fact` · `record_skill`
  (host-structured knowledge). Write boundary rejects unscoped data.
- **ACT** — `submit_action` (host-drafted body → approval queue → execute →
  deliver → audit; Comb never drafts) · `action_status`.
- **PROVE** — `query_runs` · audit trail (principal-attributed).

Every connection carries a PRINCIPAL `{id, name, kind: human|agent, scopes}` —
scopes authorize, the principal attributes (the compliance/audit story).

## 7. The data model (model-free, file → Postgres)

| Store | Shape | File / table |
|---|---|---|
| Facts | `{id, text, scope, source}` (no vectors) | `keyword-docs.json` / `brain_chunks` |
| Skills | `{id, name, triggers[], body, scope, uses, updatedAt}` | `skills.json` / `skills` |
| Intents | `{id, statement, kind, scopes[], version}` | `intents.json` / `intents` |
| Divergences | `{status, intentRef, evidence[], rationale}` | `divergences.json` |
| Actions | `{id, title, body, status, idempotencyKey, by}` + audit | `actions.json` |
| Runs | `{id, agent/principal, status, tokens, latency, steps}` | `agent_runs` |
| Retrieval manifest (CCR) | `{hash → lastUsed, count}` per session | `.comb/ccr/` |
| Calibration | per-corpus grounding signal | `calibration.json` |
| Principals | `{id, name, kind, scopes, keyHash}` | `principals` |

## 8. The restructuring (current code → target)

**Repurpose (already built, now model-free or host-driven):**
- `MemoryStore` seam → keyword store becomes the default (`COMB_RETRIEVAL=keyword`);
  vector stores (pgvector/file/S3) become the opt-in semantic upgrade.
- Context compiler + token budget + response cache → fold into the **CCR serving
  optimizer** (one module: compress + manifest-dedup + cache-align).
- Intents + divergence engine → keep, but divergence JUDGMENT moves to the host:
  Comb does model-free candidate detection (keyword overlap of new data ∩ intent),
  surfaces it; host judges and calls submit_action.
- Action service → already model-free via `proposeDirect` (host supplies body).
- Traces, evals, promote, commissioning, calibration → unchanged (governance).
- MCP server → becomes the PRIMARY surface; add record_fact/record_skill/
  find_skill/submit_action; principals on every call.

**New (the knitbrain pieces):**
1. **Skill store** (`skills.json` → PG), trigger-matched `find_skill`, `record_skill`.
2. **CCR serving optimizer** (compress + retrieval manifest + cache-align) on every MCP response.
3. **Model-free divergence** (candidate detection in Comb; judgment in host).

**Deprecate / make optional:**
- In-Comb generation (`ask_brain`, brain.draft for actions, the SELECT/COMPOSE
  pipeline, the local/openai generation backends) → become OPTIONAL legacy for
  users who want Comb to also run a model. The DEFAULT product runs no model.

## 9. Build phases (re-cut, each green + pushed)

1. **Skill store + MCP tools** — `skills.json`/PG, `record_skill`, `find_skill`,
   `record_fact`, `submit_action`; principals on MCP. (model-free brain)
2. **Model-free retrieval default** — `COMB_RETRIEVAL=keyword`
   FileKeywordMemoryStore as default; vector behind the seam.
3. **CCR serving optimizer** — compress + retrieval-manifest dedup + cache-align
   on every MCP response; generalize the compiler/budget/cache into it.
4. **Model-free divergence** — Comb candidate detection; host judgment via MCP.
5. **Polish for real users** — README/USAGE rewrite to the no-model MCP story;
   `comb init` for the MCP-first setup; npm re-publish clean.
6. **Pilot** — FIS conversation selects the wedge workflow + the first skills.

Deferred until pulled: S3 Vectors (needs AWS creds), semantic-recall upgrade,
dashboard, skill MINING from artifacts (host records skills explicitly for now;
auto-induction later).

## 10. What we refuse to build (focus)

Connector marathon (host agents are the sensors) · our-own-runtime · in-Comb
models as the default · DAG orchestration · dashboards before operators ask ·
auto skill-mining before a real workflow pulls it.

## 11. Verification & validation

- Contract tests (pure validators) · hermetic CI (mock, temp dirs, all gates
  green per commit) · behavioral evals on record fields · the promote ratchet ·
  staged autonomy.
- Product proof: a design partner connects their EXISTING agent over MCP to a
  brain of their docs; it answers with grounded citations, records how-it's-done
  skills, and the loop flags real divergence with evidence — all with Comb
  running no model. Metrics: refusal correctness, promoted-eval growth, one
  workflow reaching policy-approved autonomy, retention.

## 12. Why this is not a RAG wrapper (current state)

A RAG wrapper is four steps: ingest → embed → retrieve → hand to an LLM. Comb keeps
that spine but adds the systems work a wrapper skips — and all of it is **built and
tested today**, not aspirational:

| Concern | RAG wrapper | Comb | Where |
|---|---|---|---|
| Who can read a record | nothing | access scopes asserted on **every** read | `assertScoped`, `src/brain/memory.ts` |
| Hallucination control | hope the model cites | **deterministic refusal in code** before generation, calibrated per embedding model | `src/brain/grounding.ts` |
| Real-file ingest | usually .txt/.md | .docx · .pdf · .md · .txt · .csv · .json | `extractText`, `src/harness/ingest-files.ts` |
| Doing things | none | propose → approve → execute → **audit** | `src/actions/*` |
| Getting better | static | `record_outcome` → reward → re-rank + grow eval set | `src/feedback/*` |
| Proof it works | none | behavioural eval asserted in CI (refuse / answer-across-sources / scope-isolation) | `src/eval/*`, `test/` |

The model is the easy, swappable part. The governance, the deterministic refusal, the
action audit, and the outcome loop are the product.

### Integrity guarantees asserted in CI
- **Scope isolation** — a `leadership` record is invisible to a `default-team` caller.
- **No demo-data leak** — a real (`comb install`) brain starts empty; holds only what
  you ingest (`test/no-seed-leak.test.ts`).
- **Reset wipes knowledge** — `comb reset` clears the actual stores
  (`test/reset-targets.test.ts`).
- **272 tests** · typecheck · lint · build green.

### GTM persona example (what a prompt file can't do)
Two MCP tools (`gtm_research_prospect`, `gtm_draft_outreach`) turn the brain into a
grounded GTM agent: it builds a dossier and drafts personalized outreach **only from
cited records**, and **refuses** when ungrounded — never inventing a metric or
customer. A static `.md` prompt can't query a corpus past the context window, enforce
scopes, or refuse. The persona on the brain can.
