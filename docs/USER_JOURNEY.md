# Comb — the full user journey (every surface, every use case)

This maps **who** uses Comb, **where** (which surface), and **how** (every flow),
plus exactly **what works in which mode**. Grounded in the shipped product — no
aspirational features. Comb is **model-free**: it runs no model of its own; the
connected agent (Claude/Cursor/Copilot) is the intelligence, or you give Comb a
model explicitly (Ollama / a key).

---

## 1. Who uses it (three roles)

| Role | What they do | Primary surface |
|---|---|---|
| **Operator** | sets up the brain, ingests data, configures, approves actions | CLI + Webapp |
| **AI agent + its human** | asks questions, gets cited answers, takes actions | MCP (Claude/Cursor/Copilot) |
| **Developer** | wires Comb into an app or workflow | HTTP API + library |

---

## 2. Where (five surfaces)

1. **CLI (`comb`)** — the operator console. Setup, ingest, skills, intents, the loop, approvals, observability.
2. **MCP server (`comb mcp`)** — the product front door. Any MCP client connects; the agent gets 15 governed tools. **This is where the "answering" happens** (the agent is the model).
3. **HTTP API** — for apps, webhooks, and workflows (n8n/Zapier): ingest, search, ask, actions.
4. **Webapp console** — operator GUI: Search, Ingest, Sources, Approvals, Settings, Connect.
5. **Library (`import { Brain }`)** — embed the governed brain in your own Node app.

---

## 3. The three modes (what works where)

| Capability | Model-free (default) | With a model (`LLM_BACKEND=local`/`openai`) | Vector (opt-in) |
|---|---|---|---|
| Ingest (text/csv/json/folder/url) | ✅ | ✅ | ✅ |
| **Search** (cited records) — `search_brain`, `/api/search`, webapp | ✅ keyword | ✅ keyword | ✅ semantic |
| Skills (record / find) | ✅ | ✅ | ✅ |
| Intents + divergence candidates | ✅ | ✅ (+ model verdict) | ✅ |
| Actions: **submit** → approve → execute → audit | ✅ | ✅ | ✅ |
| `record_outcome` → reward → compound | ✅ | ✅ | ✅ |
| **Answering** (`ask_brain`, `comb run/chat`, `/api/ask`) | ⛔ **gated** — your connected agent answers instead | ✅ Comb generates | ✅ |
| `propose_action` (Comb drafts the body) | ⛔ gated → use `submit_action` | ✅ | ✅ |

**Key:** in the default model-free mode, Comb never fabricates an answer. It hands
the cited records to your agent (over MCP) and the agent writes the answer. To let
Comb answer on its own, set a model. Either way the data is real — no mock.

---

## 4. The full journey (every stage, with the exact commands/tools)

### Stage 0 — Install & connect (Operator, ~2 min)
```bash
npm i -g open-company-brain
comb install claude        # or cursor | vscode | claude-code | windsurf
```
Writes the MCP config (model-free, your-data-only, shared brain dir). Restart the tool.
- CLI: `comb init` (guided backend setup), `comb doctor` (what's live).

### Stage 1 — Ingest knowledge (Operator)
```bash
comb ingest ./company-docs          # a folder (recursive), or a file, or a URL
comb ingest notes.md --source handbook --scope finance-team
```
- HTTP: `POST /api/ingest`  ·  Webapp: **Ingest** tab  ·  Webhook: point n8n/Zapier at `/api/ingest`.
- Real data only — no demo seed unless you run `comb demo-data`.

### Stage 2 — Find / answer (AI agent + human)
- **Model-free (default):** in Claude/Cursor — *"search the brain for the refund policy"* → the agent calls `search_brain`, gets cited records, **writes the answer** (or refuses if no grounding).
- CLI/HTTP/Webapp search: `comb` (via agent) · `POST /api/search` · Webapp **Search** tab.
- **With a model:** `comb run "..."`, `comb chat`, `ask_brain`, `/api/ask` all generate grounded, cited answers.

### Stage 3 — Record how work is done (Operator / agent)
```bash
comb skill "Handle a refund" --body "verify → check threshold → VP sign-off if >10k" --triggers refund,return
comb skills "customer wants money back"      # trigger-matched
```
- MCP: `record_skill` / `find_skill`. This is the **executable skills file** — the moat.

### Stage 4 — Declare intent, watch reality diverge (the loop)
```bash
comb intent "Refunds over 10000 require VP sign-off" --kind policy
# ...ingest reality (logs, tickets)...
comb divergences                              # candidates: reality that overlaps an intent
```
- MCP: `declare_intent` / `list_intents` / `list_divergence_candidates`. The agent judges which candidates are real divergences.

### Stage 5 — Take a governed action
```bash
# agent (MCP): submit_action  (you draft) OR propose_action (Comb drafts — needs a model)
comb actions                                  # the approval queue
comb approve <id>                             # executes + delivers + audits (idempotent)
comb reject <id> "reason"
```
- Webapp: **Approvals** tab (approve/reject). HTTP: `/api/actions`, `/api/actions/:id/approve`.

### Stage 6 — Close the loop on outcomes (compounding)
- MCP: `record_outcome(actionId, replied|converted|ignored|error|reverted)` → feeds the reward that re-ranks the records that produced a win. The brain gets better with use.

### Stage 7 — Configure to your preference (Operator)
```bash
comb init                                     # guided
```
- Webapp **Settings** tab or `POST /api/config`: change backend (model-free/local/openai/langbase), retrieval (keyword/vector), keys, and **Amazon S3 Vectors (BYO — your own bucket)**. Persisted to `.env`; applied on restart.

### Stage 8 — Observe, test, harden (Operator)
```bash
comb runs                                     # every run: tokens · latency · tools · status
comb trace <id>                               # full tool-call autopsy
comb eval                                     # grounds · refuses · tool-use · scope
comb calibrate --labels labels.json           # tune the refusal floor to your corpus
comb promote <run id>                         # turn a real failure into a permanent test
```

---

## 5. The recommended golden path (what to demo / onboard with)
```
comb install claude → comb ingest ./your-docs → ask Claude → cited answer
→ comb skill "..." (record how work is done) → comb intent + comb divergences
→ submit_action → comb approve → record_outcome
```
That's the whole loop on real data, model-free, in your own AI tool.

---

## 6. Backends & storage (BYO)
- **Generation:** none (model-free, agent answers) · Ollama (local, $0) · OpenAI-compatible key · Langbase.
- **Retrieval:** keyword (default, file-persistent, $0) · vector (file / Postgres+pgvector / **Amazon S3 Vectors, BYO**).
- **Persistence:** in-memory (tests) → JSON files `.comb/` (zero-setup) → Postgres (prod). All BYO — Comb stores nothing on anyone else's infra.
