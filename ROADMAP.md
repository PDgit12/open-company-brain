# Roadmap

What's intentionally **not** in the current release, how each plugs into the existing
architecture, and the *trigger* that makes it worth building (not arbitrary dates).

The current release is a complete, governed, read-heavy core plus a working action
layer, multi-scope access, incremental sync, a graph backend, enrichment, a health
agent, streaming, observability, and evals — all verified in mock mode.

---

## 🟢 Cheap, seams already exist, high value

### Real outbound actions (delivery providers)
- **What:** today write-actions execute to a safe outbox (recorded, not sent). A real
  executor performs the side effect — e.g. send an email, create a CRM task, post to
  Slack/Teams, update a record.
- **How:** implement `ActionExecutor` (`src/actions/executor.ts`) for the chosen
  provider. Human-approval, idempotency, and audit are already wired around it.
- **Effort:** ~half a day per provider.
- **Trigger:** once you trust the drafts/proposals in the demo, and have the
  provider's API key. Pick the action that matters for your domain — email is only
  one example; logging to your own DB already works.

### Live LLM enrichment
- **What:** replace deterministic theme tagging with an LLM call.
- **How:** swap `deriveThemes()` in `src/brain/enrichment.ts` for a Generator call
  using a **closed tag vocabulary** (so tags stay inspectable).
- **Effort:** ~half a day.
- **Trigger:** keys are live AND keyword tags prove too coarse.

---

## ✅ Shipped (v0.3.0)

### Recursive learning (feedback loops) — DONE
The mechanism shipped; its *value* compounds once weeks of real verdicts accrue.
- ✅ Capture signal — `POST /api/feedback` + a scope-gated `FeedbackStore`; action
  approve/reject also records.
- ✅ Re-rank retrieval — `rerankByReward` boosts useful sources, demotes rejected
  (in the Brain layer, so it works for every backend; bounded + no-op on a cold brain).
- ✅ Grow the eval set — rejected refusals become `has_sources` regression
  candidates at `GET /api/eval/candidates` (human-review queue, not an auto CI gate).
- ✅ Few-shot prompts — approved past answers injected as exemplars in `ask()`.

Still genuinely deferred: a *trained* learning-to-rank model and longitudinal
quality tracking — both need weeks of accrued outcomes before they're worth building.

### Fully-local backend ($0/query) — DONE
- ✅ `LLM_BACKEND=local`: Ollama generation + Ollama embeddings + pgvector recall,
  behind the existing seams. `npm run setup:local`.

---

## 🔵 Presentation, when stakeholders ask

### Visual relationship-map UI
- **What:** a clickable graph of companies/contacts/programs.
- **How:** add `/api/graph` (nodes+edges from the existing graph layer); render in the
  webapp with a graph lib (react-force-graph / cytoscape). `/api/intro-path` already
  powers "show the connection."
- **Effort:** ~2–4 days. Pure presentation; no core changes.
- **Trigger:** stakeholders want to *see* the network, not just query it.

---

## ⚪ Only if a hard requirement forces it

### Literal federated sub-brains
- **What:** separate per-team/per-tenant brains that sync to a main brain.
- **Why deferred:** the current **scoped-views** model (multi-scope access over one
  brain) already delivers the outcome with far less complexity. Literal federation is
  the hardest distributed-systems problem here.
- **How (if ever):** each sub-brain = its own Memory + data source; a router brain
  queries them and merges under access checks; sub-brains push digests upward.
- **Trigger:** a concrete constraint only — data residency (a tenant's data legally
  cannot live in a shared store) or hard multi-tenant isolation. Never speculatively.

---

## Suggested sequence
1. Real outbound action (the one that matters for your domain)
2. Live LLM enrichment (once keys are live)
3. Start capturing feedback now → recursive learning once data accrues
4. Visual graph UI when stakeholders want it
5. Federation only if a compliance/residency requirement appears
