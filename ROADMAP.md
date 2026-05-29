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

## 🟡 Needs real usage data first

### Recursive learning (feedback loops)
- **What:** the brain improves from outcomes over time.
- **How (phased):**
  1. Capture signal — the action audit log (approved/rejected) already exists; add a
     `/api/feedback` endpoint + `feedback` store for thumbs up/down on answers.
  2. Re-rank retrieval — boost sources marked useful, demote rejected (extend
     `memory.retrieve`).
  3. Grow the eval set — every bad answer becomes a new golden case.
  4. Few-shot prompts with approved examples.
- **Effort:** capture is cheap; learning is ~1–2 weeks.
- **Trigger:** start *capturing* now; do the *learning* once weeks of real outcomes
  have accrued (nothing to learn from on day one).

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
