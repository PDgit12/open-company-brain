# Comb — The Complete Architecture (v2, locked)

> THE design authority. Code converges toward this document phase by phase;
> when code and document disagree mid-migration, the document wins unless a
> phase note says otherwise. Read top to bottom: idea → principles → stack →
> planes → data → flows → surfaces → build plan → verification → deployment →
> what we refuse to build → how we know it's working.

---

## 1. The locked idea

**Comb turns a company from an open loop into a closed loop: every answer
provable, every action authorized, every failure a permanent test — one
self-hosted kernel any agent connects to over MCP.**

This is YC RFS "The AI Operating System for Companies" (Diana Hu), with our
differentiation: **enforcement**. Everyone else *observes* the loop (eval
dashboards, audit logs, search); our loop **gates** — ungrounded answers are
refused before generation, unauthorized actions don't execute, failing agents
don't run, autonomy is earned with evidence.

What we are NOT (named so we never drift):
- **Not an agent runtime.** Claude Code, Strands, Copilot, OpenClaw are
  channels that connect to us — never competitors. Our own runner is a
  reference client.
- **Not enterprise search.** Onyx/Glean own the 40-connector game; we refuse
  it. Integration strategy = **agents-as-sensors**: external agents feed the
  brain through MCP write tools as a by-product of working.
- **Not an observe-only eval platform.** Confident-AI-class tools measure;
  they have no teeth. Our evals are runtime gates.

Subsumed RFS: Company Brain (Blomfield) = our memory subsystem. Software for
Agents (Epstein) = our interface philosophy (machine-readable first).

## 2. The two principles everything derives from

**P1 — The model is never the authority.** Every trust decision is
deterministic code, before or after the model: may it see (SQL scope filter),
may it answer (calibrated score gate), may it act (human/policy approval),
is it improving (eval gates). The model makes judgments only inside
schema-constrained forms that code validates.

**P2 — Reliability work must compound, never be rented.** A validator written
once holds for every model forever. A promoted eval gates forever. A
calibration is re-runnable data. Prompt wording (the one rented artifact left)
is pinned, comment-guarded, and changed only with a live A/B.

## 3. The stack (every choice, with the reason)

| Layer | Choice | Why (and why not the alternative) |
|---|---|---|
| Language | TypeScript (strict), Node ≥20, ESM | one language across kernel/CLI/server; types ARE the contract system (P1); no Python split-brain |
| Truth store | **PostgreSQL** (single instance) | one database holds vectors + agents + memory + traces + queue + audit → transactional consistency, one backup, one `docker compose up` |
| Vectors | **pgvector** (default) + **S3 Vectors** (first-class option, `VECTOR_BACKEND=s3`) | pgvector: colocated with truth, scope filter in the same WHERE clause as similarity (access control can't desync), 2026 consensus starting point, ~10M-vector comfort. S3 Vectors: ~90% cheaper at scale, serverless, the AWS-native + massive-corpus choice — supported as an equal `MemoryStore` impl (same scope + score contract; calibration handles its distribution by design). Decision rule: interactive hot path & self-host-only deployments → pgvector; AWS-native or >10M vectors or cost-driven → S3 Vectors; both can tier (hot PG / cold S3). **Also seam-ready: Qdrant** |
| Queue (phase 6) | **PG `FOR UPDATE SKIP LOCKED`** | atomic claim+lock in one transaction, ACID with the rest of the kernel; 2026 guidance: "adding Redis for job queuing alone is engineering overhead" when PG exists. Ceiling ~100–200 jobs/s — orders above agent-task volume. **Escape hatch: BullMQ+Redis** if flows/rate-limit complexity ever pulls |
| Local models | **Ollama** (qwen2.5:3b default; any ≤3B works) | $0/query, self-host wedge, grammar-constrained decoding (`format:<json-schema>`), `/api/show` window introspection, keep_alive |
| BYO cloud | **OpenAI-compatible protocol** | one protocol = OpenAI/Groq/Together/OpenRouter/LM Studio/vLLM; structured outputs supported |
| Embeddings | nomic-embed-text (local) / text-embedding-3-small (BYO) | independent of generation model; calibration is stored PER embedder because score distributions differ |
| HTTP | Express 4 | our API is small and DB/LLM-bound — 2026 benchmarks show framework choice moves DB-bound APIs ~30%, while LLM latency dominates by 100×; migration cost > benefit. **Escape hatch: Hono** (edge-portable, Fetch-native) if surfaces are ever rebuilt |
| Agent bus | **@modelcontextprotocol/sdk** | MCP is the winning agent-interface standard; primary product surface |
| Validation | zod (config), hand-rolled pure validators (records) | record validators must be dependency-free pure functions — they're the product |
| Tests | vitest, hermetic (mock backend + temp dirs) | every commit gates on typecheck+lint+test+build; live verification is a separate, explicit step |
| Tokenizer | chars/4 heuristic default; optional gpt-tokenizer (BPE) | zero-dep default keeps install trivial; exactness is opt-in |
| Zero-setup tier | atomic JSON files under `.comb/` | the product must run with NO database for evaluation; same interfaces, swap to PG via one env var |
| Deliberately absent | LangChain/LlamaIndex, queues (Redis/SQS), k8s, React build chain | each is either the commodity we refuse, or complexity before a user pulls it. PG `FOR UPDATE SKIP LOCKED` is the queue |

## 4. The planes (complete component map)

```
┌─ SURFACES ──────────────────────────────────────────────────────────────┐
│  MCP server (PRIMARY: read/write/act/prove) · CLI (operator console)    │
│  HTTP API (webhooks, dashboard-later) — all calls carry a PRINCIPAL     │
├─ AGENT RUNTIME ─────────────────────────────────────────────────────────┤
│  AgentDefinition rows · creation spine (draft→validate→birth kit→       │
│  COMMISSION→register) · per-agent memory (hygiene-gated) · tool fabric  │
│  (granted tools only, results clamped) · 3 execution shapes             │
├─ TRUST KERNEL ──────────────────────────────────────────────────────────┤
│  scope filter IN SQL · calibrated grounding gate (pre-generation) ·     │
│  typed AnswerRecord + validators · SELECT/COMPOSE constrained decoding ·│
│  context compiler (budgeted sections) · token budgets (circuit breaker) │
├─ ACTION PLANE ──────────────────────────────────────────────────────────┤
│  propose→approve(human|policy)→execute(idempotent)→deliver(sink) ·      │
│  durable approval queue · autonomy dial L0/L1/L2 (earned, rate-capped) ·│
│  audit log (principal-attributed)                                       │
├─ QUALITY PLANE (the closed loop) ───────────────────────────────────────┤
│  traces (every run: prompt, record, tokens, latency, principal) ·       │
│  behavioral evals on record FIELDS · live LLM judge · runs --failed →   │
│  promote → permanent regression · per-corpus calibration · commissioning│
├─ KNOWLEDGE PLANE ───────────────────────────────────────────────────────┤
│  refinery: normalize→CLEAN(dedupe/strip)→enrich→SCOPE-STAMP(reject      │
│  unscoped)→chunk→embed→store · sources: CLI/webhook/MCP-write/paste     │
├─ MODEL PLANE (swappable, never trusted) ────────────────────────────────┤
│  Generator/Embedder seams · mock|local|openai-compat|langbase ·         │
│  dynamic context window · temp 0 · retries/timeout/keep_alive ·         │
│  response cache (deterministic runs only)                               │
└─ PERSISTENCE LADDER (every store) ──────────────────────────────────────┘
   in-memory (tests) → JSON file .comb/ (zero-setup) → Postgres (prod)
```

## 5. The data model (every durable structure)

**Postgres tables** (file-tier equivalents in `.comb/*.json`):
| Table | Holds | Key fields beyond the obvious |
|---|---|---|
| `brain_chunks` | embedded knowledge | `access` (scope, filtered in SQL), `source`, `embedding vector(d)` |
| `custom_agents` | agent definitions | `lifecycle jsonb`: version, toolGrants[], outputContract, autonomy L0-L2, enabled, commissioned |
| `agent_conversations` | episodic memory | `grounded bool` — only grounded turns replay (poison hygiene) |
| `agent_runs` | traces | `status` (AnswerRecord enum), steps jsonb, tokens, latency, [principal_id — phase 5.5] |
| actions (file: `actions.json` + `action-audit.json`) | approval queue + audit | idempotencyKey (content-derived), status, effect, [principal] |
| `task_inbox` [phase 6] | TaskEnvelope queue | agentId, input, origin, principal, status, `FOR UPDATE SKIP LOCKED` |
| principals [phase 5.5] | API keys → identity | id, name, kind human|agent, scopes[], keyHash |

**`.comb/` data dir extras:** `calibration.json` (per-embedder floors),
`birthkits/<agentId>.json` (labels + starter scenarios), `token-usage.json`,
`response-cache.json`, `comb-regressions.json` (promoted suite, repo-level).

**The typed contract (the spine of P1):**
```ts
AnswerRecord { status: 'answered'|'insufficient_context'|'memory_reply',
               answer: string, citations: RetrievedChunk[] }
// invariants IN CODE: answered ⇒ citations≥1 ∧ answer≠'';
// refusal/memory ⇒ citations=0. renderAnswer() is the ONLY prose assembler.
```

## 6. The flows (every case, end to end)

**F1 — Life of a prompt (ANSWER shape):**
interface(resolve agent row + principal + scopes) → context compiler (typed
sections, window-budgeted) → recall (embed → pgvector, scope in WHERE) →
**GATE** (best score vs calibrated floor → refuse before any model) →
**SELECT** (model, grammar-constrained: relevant item indexes; recall-biased;
empty = structural refusal) → **COMPOSE** (model, constrained: fills
AnswerRecord; citations = indexes ⊆ selected — subset proof; one named-repair
retry; degrade to single-shot → legacy prose) → validate → render at edge →
post-run (grounded-only memory write, trace w/ status, token meter).
Exactly two model touchpoints, both schema-bound.

**F2 — Agent lifecycle:** intent (wish | data-born | API) → DRAFT (architect
model call, constrained JSON, deterministic fallback) → VALIDATE (collisions,
scopes, grants exist) → BIRTH KIT (calibration labels + starter eval scenarios
+ budgets, persisted) → **COMMISSION** (suite must pass → commissioned=true;
failing = stays draft; legacy grandfathered) → registered, versioned, L1.
Promotion to L2 requires accrued eval evidence. Retire = disabled row; memory
archived; traces kept.

**F3 — Task acquisition:** on-demand (CLI/MCP/API) | reactive (ingest fan-out
match) | scheduled (cron on definition) | delegated (another agent/system
posts) → ONE TaskEnvelope → inbox → worker loop → F1/F4/F5. No trigger gets a
special code path.

**F4 — ACT shape:** F1 through the gate, but COMPOSE yields an ActionProposal
→ approval queue (durable) → human approve (L1) or policy approve (L2:
grounded-only, hourly rate cap, audited as policy) → idempotent execute →
deliver (outbox/file/webhook) → audit. Grounding is checked BEFORE policy —
autonomy never overrides truth.

**F5 — WORK shape (tool loop):** model picks among GRANTED tools only
(constrained function calls) → harness executes scope-gated → results clamped
(~24k chars) → iterate ≤ step budget → final record. Every step traced.

**F6 — The closed loop (the product):** every run traced → `runs --failed`
triage (field-read classification: refused/ungrounded) → `comb promote <run>`
→ permanent regression scenario → `comb eval` gates → recalibrate as corpus
grows → autonomy promotions/demotions from evidence. Failure is fuel.

**F7 — Onboarding journey:** install → `init`/`doctor` (mock|local|BYO key)
→ ingest (refinery) → calibrate (floor from THEIR corpus) → `comb new` (agent
born with kit) → commission → operate (chat/MCP) → manage (runs/trace/
actions/budget) → grow (scopes/agents/replicas) → incident (trace/forget/
disable/rate-caps) → retire. Every stage hands the next a verified artifact.

## 7. The surfaces (phase 5.5 spec)

**MCP server (primary):** tools = `brain.search`, `brain.ask` (record-shaped
result), **`brain.ingest`** (agents-as-sensors), **`actions.propose` /
`actions.status`**, **`runs.query`** (prove). Every connection authenticates
to a principal; tool calls inherit its scopes.

**Principals:** `{id, name, kind: human|agent, scopes[]}` from API key (HTTP)
or MCP connection config. Authorization unit = scope; **accountability unit =
principal** (traces, actions, audit all attribute). This converts the
MCP-governance compliance gap (shared creds = no attribution) into a feature.

**CLI (operator console):** ingest · new/create/commission/agents/forget ·
run/chat (slash commands) · calibrate · runs/trace/promote/eval · actions/
approve/reject · budget · doctor/init. Beautiful, TTY-gated ANSI.

**HTTP:** ingest webhook (n8n-class), ask/draft, actions, fanout config,
stats. Wire format stays `{answer, sources}` + `record`.

## 8. The build plan (phases, deliverables, acceptance)

| Phase | Deliverable | Acceptance criteria | Status |
|---|---|---|---|
| 0 | this document | reviewed & locked | ✅ |
| 1 | typed AnswerRecord end-to-end | consumers read fields; refusal = enum; traces carry status; all tests green | ✅ `e8f5bb9` |
| 2 | constrained decoding + validation + repair | citation subset proof; live: paraphrase Q answers on 3B | ✅ `4f7b4ef` |
| 3 | SELECT/COMPOSE split | structural refusal (empty selection); injected-Llm hermetic tests; live on 3B | ✅ `6ade85a` |
| 4 | context compiler + refinery CLEAN | one assembler w/ per-section report; dedupe-per-scope in every ingest path | ✅ `3624be7` |
| 5 | AgentDefinition v2 + commissioning | part 1 ✅ `0c191fd` (registry+lifecycle); part 2: `comb commission`, runnable-gate in agent resolution, `comb new` births uncommissioned w/ kit; live: a failing draft cannot run | ◐ |
| 5.5 | identity inversion | MCP write/act/prove tools; principals on MCP+HTTP; traces/audit attributed; README/CHANGELOG lead with the locked sentence | — |
| 6 | TaskEnvelope + inbox + scheduler | 4 triggers → 1 queue (PG SKIP LOCKED); worker loop; cron trigger fires | — |
| 7 | corpus profile + data-born factory | ingest → proposed agents w/ auto-labels + auto-suites, commissioned at birth | — |
| 8 | ops | config injection (kill frozen global) · PG budget/cache tiers · S3 Vectors store behind MemoryStore seam (needs AWS creds) · dashboard (maintenance/analytics/brain-graph) | — |

Per-phase discipline: typecheck+lint+test+build green → live verification on
qwen2.5:3b (≤3B constraint) → commit with the lesson in the message → push →
deep technical explanation.

## 9. Verification spine ("how we know nothing is broken")

1. **Contract tests** — record/select/compose validators are pure functions.
2. **Hermetic CI** — mock backend, temp-dir persistence, 197+ tests, every
   commit gates on all four checks.
3. **Behavioral evals** — `comb eval` asserts on record FIELDS (cites/refuses/
   tools/budget/scope); judge + memory layers live-only, skip (not fail) on mock.
4. **The ratchet** — prod failures promoted to permanent regressions.
5. **Determinism** — temperature 0; same input ⇒ same output; cache-keyed.
6. **Pinned prompts** — the two model-facing prompts are empirically
   calibrated artifacts; comments forbid rewording without a live A/B
   (3B regressed twice on "harmless" rewordings: refusal-last phrasing, and
   dropping the trailing imperative / paraphrase example).
7. **Staged autonomy** — L2 only on eval evidence; rate caps; policy-vs-human
   audit distinction.

## 10. Deployment topology

- **Solo/zero-setup:** `npx` → mock or Ollama + `.comb/` files. No DB.
- **Team:** `docker compose up` = harness + Postgres(pgvector); Ollama or BYO
  key beside it. Everything durable in one PG.
- **Scale:** N harness replicas share one PG; inbox queue makes workers
  horizontal; agents/memory/traces/evals are rows so replicas are stateless.
  Storage tiers: pgvector hot, S3 Vectors cold (phase 8).
- **Security model:** scopes in SQL (read AND write boundaries — unscoped
  docs rejected), principals for attribution, ingest auth + rate limits,
  secrets only in env, audit log append-only.

## 11. What we refuse to build (so focus survives)

Connector marathon (Onyx's ground) · our-own-runtime ambitions · DAG
orchestration engine (delegation = envelopes between inboxes) · dashboards
before operators ask · Expectations/business-monitoring object, machine
output contracts, n8n node — all DEFERRED until a real user pulls them.

## 12. How we know it's working (product validation)

- **The 30-minute pilot:** a design partner ingests real docs → calibrates →
  connects their EXISTING agent (Claude Code/Copilot) via MCP → it answers
  with citations, refuses what it shouldn't know, and every exchange is
  attributed and traceable.
- **Metrics that matter:** refusal correctness on their labeled set (target:
  calibration ≥90/90) · promoted-eval count growing weekly (the ratchet is
  alive) · one action workflow reaching L2 on evidence · retention: would
  they be upset to lose it.
- **Channels:** show-don't-tell post (the "3B that refuses instead of
  hallucinating, with receipts" demo) on r/LocalLLaMA + HN · npm publish ·
  YC application on RFS #16 with the enforcement differentiation.
