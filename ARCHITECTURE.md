# Comb v2 — Target Architecture (system of record)

> This document is the design authority. Code converges toward it phase by
> phase; when code and this document disagree during the migration, the
> document wins unless a phase note says otherwise.

## The one principle

**The model is never the authority, and the model never speaks prose to the
system.** Every trust decision is deterministic code; every model output is a
schema-constrained, validated record. Prose exists only at the very edge where
a human reads it. Reliability work must COMPOUND (a validator written once
holds for every model forever) — never be rented (prompt tweaks per model).

## Life of a prompt (the spine)

```
user prompt (CLI / chat / API / webhook)
  1 INTERFACE      parse · resolve agent (a row) · resolve scopes      [code]
  2 CONTEXT        compile typed sections under the resolved window:   [code]
     COMPILER      system · instruction · memory(grounded-only,
                   budgeted) · (grounding added at step 5)
  3 RECALL         embed query · pgvector search, scope filter IN SQL  [code]
  4 TRUST GATE     calibrated grounding floor on scores →              [code]
                   thin? → refusal record (or memory-path if grounded
                   dialogue exists) — model never sees noise
  5 SELECT         "which chunk-ids answer this?" → {relevant:[ids]}   [model, constrained]
                   validated: ids ⊆ retrieved. none → refusal record   [code]
  6 COMPOSE        fill AnswerRecord{status, answer, citations[ids]}   [model, constrained]
  7 VALIDATE       schema · citations ⊆ selected · status coherence;   [code]
                   one repair retry, else refusal record
  8 RENDER         record → prose + Sources footer (edge only)         [code]
  9 POST-RUN       memory write (grounded only) · trace · token meter  [code]
                   · run classifier (reads FIELDS, never greps prose)
```
Exactly two model touchpoints (5, 6), both schema-constrained with code
validation after each. Everything else is deterministic.

## Agent lifecycle — the creation spine (ALL paths converge)

```
INTENT (human wish · corpus profile · API call · imported agent)
  → DRAFT       architect model call (constrained JSON) proposes:
                {name, instruction, retrieval query, triggers, tool grants,
                 output contract, calibration labels}            [model]
  → VALIDATE    name collision · scopes exist · granted tools exist in the
                fabric · schema                                   [code]
  → BIRTH KIT   auto-attached at creation:                        [code]
                · calibration labels (answerable + unanswerable)
                · starter eval suite (behavioral scenarios)
                · empty memory · budget defaults · autonomy = L1
  → COMMISSION  the agent must PASS its starter evals to become   [gate]
                runnable ("born tested"); failing agents stay drafts
  → REGISTER    versioned row. Promotion L1→L2 requires accrued
                eval evidence — autonomy is EARNED per agent.
```

### AgentDefinition v2 (the row, extended)
```ts
AgentDefinition {
  id, name, version, createdAt
  instruction: string            // what it does
  query: string                  // fallback retrieval intent (empty-task runs)
  scopes: string[]               // the VIEW of the brain it holds
  triggers: Trigger[]            // how it receives work (see below)
  toolGrants: string[]           // fabric tool ids it MAY call (default: brain.*)
  outputContract: 'answer' | JsonSchema   // prose record or machine schema
  autonomy: 'L0' | 'L1' | 'L2'   // per-agent dial position
  enabled: boolean
}
```

## Task acquisition — four triggers, ONE envelope, one spine

```
1 ON-DEMAND   human prompt (CLI · chat · API)            → envelope (direct)
2 REACTIVE    data arrival: ingest fires fan-out for
              agents whose trigger matches scope/source  → envelope (queued)
3 SCHEDULED   cron expression on the definition
              ("mon 09:00: renewal digest")              → envelope (queued)
4 DELEGATED   another agent or external system posts
              a task to this agent's inbox               → envelope (queued)

TaskEnvelope { agentId, input, origin, scopes, createdAt, deadline? }
```
The inbox is a Postgres-backed queue (file tier for zero-setup). A worker loop
inside the harness drains it; on-demand bypasses the queue. MANY triggers, ONE
execution spine — no trigger gets a special code path.

## Execution modes — three shapes on the same spine

| Mode | When | Spine difference |
|---|---|---|
| **ANSWER** | questions, digests | the life-of-a-prompt below (steps 1–9) |
| **ACT** | the task implies a side effect | COMPOSE fills an ActionProposal record instead → action lifecycle (propose → approve/policy → execute → deliver) |
| **WORK** (tool loop) | task needs tools | loop: model picks a granted tool (constrained function call) → harness executes scope-gated → result clamped → repeat ≤ step budget → final record. Every step traced. |

The definition's `toolGrants` + `outputContract` decide which shapes an agent
may take. Multi-agent = DELEGATED envelopes between inboxes (no DAG engine in
v2 core; orchestration stays data, not code).

## The typed contract (kills the string-matching failure class)

```ts
AnswerRecord {
  status:    'answered' | 'insufficient_context' | 'memory_reply'
  answer:    string                 // prose for the human
  citations: ChunkId[]              // ids of chunks WE retrieved — verified ⊆
}
```
- Refusal is an ENUM, not a magic string. classifyRun, evals, actions, memory
  hygiene read fields.
- `answered` with empty citations is INVALID (rejected in code).
- Enforced via constrained decoding (Ollama `format:<json-schema>`, OpenAI
  structured outputs) + a one-retry repair loop + deterministic refusal
  fallback. The contract cannot be broken, only declined.
- Small-model strategy: SELECT (step 5) is selection — easy for a 3B — so
  refusal becomes the structural fact "no ids selected", not a behavioral
  choice the model makes in prose.

## Planes and ownership

| Concern | Owner | Mechanism |
|---|---|---|
| Who may see data | Postgres | scope filter in the SQL WHERE clause; write boundary rejects unscoped docs |
| May it answer | Trust gate | calibrated per-embedder floor (comb calibrate), pre-generation |
| Response content | Model (×2) | constrained SELECT + COMPOSE, validated |
| Prompt assembly | Context compiler | typed sections, per-section token budgets vs resolved window; compiled prompt recorded in the trace |
| Agent identity | Registry | agents are ROWS (name·instruction·query), versioned; created by factory/wizard/API |
| Memory | Conversation store | per-agent id; grounded-only writes AND replay (hygiene); budgeted into prompts |
| Tokens | Token plane | window packing (physics) · per-scope budgets (blast-radius) · metering (traces/$) |
| Actions | Action service | propose→approve→execute; idempotency-by-content; durable queue; autonomy dial L0–L2 (policy approve, rate-capped) |
| Quality | Eval plane | behavioral evals on RECORD FIELDS · live LLM judge · prod→eval promote ratchet · calibration artifacts |
| Observability | Run store | every run: compiled prompt, record, tokens, latency, steps |
| Persistence | Ladder | in-memory (tests) → JSON file (zero-setup) → Postgres (prod) — every store |

## The data refinery (brain feeding) and the agent factory

```
sources (paste · file · webhook · connectors)
  → NORMALIZE (text/csv/json → records)
  → CLEAN     (dedupe · strip boilerplate)            [build: phase 4]
  → ENRICH    (themes/entities, closed vocabulary)
  → SCOPE     (stamped; unscoped rejected at write)
  → CHUNK → EMBED → pgvector
  → PROFILE   (what does this corpus contain/support?) [build: phase 5]
  → AGENT FACTORY: from the profile, PROPOSE the agents this data can
    support — each born with (a) a definition, (b) auto-derived calibration
    labels, (c) a starter eval suite. Data-born agents: the pipeline
    creates its own workforce, pre-calibrated and pre-tested.
```
Agents connect to the brain through exactly one interface: governed retrieval
(scoped) + the typed generation pipeline. No agent holds data; it holds a VIEW.

## Verification spine ("nothing broken")

1. Typed contracts → contract tests (validators are pure functions).
2. Hermetic CI: mock backend, temp-dir persistence, 178+ tests; every commit
   gates on typecheck · lint · test · build.
3. Behavioral evals (`comb eval`) on record fields; judge layer live-only,
   skips on mock.
4. The ratchet: flagged prod runs → `comb promote` → permanent regression.
5. Determinism: temperature 0 for the fact pipeline; cache-keyed runs.
6. Staged autonomy: L2 only after eval evidence; rate caps; audit distinguishes
   policy from human.

## Migration phases (each green, each shippable)

0. This document. ✅
1. Typed AnswerRecord end-to-end (brain.ask/draft return records; render at
   edges; classifier/evals/memory consume fields). Prose string-matching dies.
2. Constrained decoding + validation + repair loop (Ollama json-schema; OpenAI
   structured outputs).
3. SELECT/COMPOSE split (small-model reliability; refusal = empty selection).
4. Context compiler (one assembler, budgeted sections, prompt-in-trace) +
   refinery CLEAN stage (dedupe/boilerplate).
5. AgentDefinition v2 (triggers · toolGrants · outputContract · autonomy) +
   the creation spine with BIRTH KIT + COMMISSIONING gate.
6. TaskEnvelope + inbox queue + worker loop (reactive/scheduled/delegated
   triggers unified); scheduler.
7. Corpus PROFILE + agent factory (data-born agents w/ auto-calibration +
   auto-evals, commissioned at birth).
8. Ops: config injection (kill import-frozen global) · PG tiers for
   budget/cache · dashboard (maintenance/analytics/brain-graph).

## The onboarding lifecycle (canonical journey — the UX the build serves)

```
0 ARRIVE      install → comb init (detects: key? local model? neither=mock)
              → doctor verifies → empty, governed brain. <10 min, zero data.
1 FEED        ingest (file/paste/webhook/connector) → refinery
              (normalize→clean→enrich→scope→embed). Brain refuses everything
              it doesn't know — honest from minute one.
2 CALIBRATE   comb calibrate places the refusal floor from THEIR corpus
              (factory auto-derives labels in v2). Trust tuned, not assumed.
3 BIRTH       wish or data-born proposal → draft → validate → birth kit
              (labels+evals+budgets) → COMMISSION (must pass) → registered L1.
4 OPERATE     four triggers → one inbox → three shapes (answer/act/work).
              Every run: gated, typed, traced, metered, remembered (hygiene).
5 TRUST       human approves actions (L1) → eval evidence accrues →
              promotion to L2 (policy-approved, rate-capped) is EARNED.
6 MANAGE      the operator loop: runs --failed (triage) → promote (ratchet)
              → eval (gate) → budget/actions/traces. Weekly: recalibrate as
              data grows; review autonomy grants.
7 GROW        new team = new scope (one flag) · new data = same refinery ·
              new agents = same spine · scale = replicas sharing PG.
8 INCIDENT    trace = the autopsy · forget = memory quarantine · disable =
              one flag · rate caps bound blast radius · audit answers "who
              decided what, based on what, approved by whom".
9 RETIRE      agent: disabled row, memory archived, traces kept.
              data: delete by source/scope; recalibrate. Nothing orphaned.
```

## Non-goals (so the architecture stays honest)

- Not a better RAG: retrieval is a commodity subsystem we consume.
- Not a model: capability is rented from the model plane, swappable.
- Not an automation platform: n8n/Zapier keep the plumbing; Comb is the
  governed judgment node inside it.
