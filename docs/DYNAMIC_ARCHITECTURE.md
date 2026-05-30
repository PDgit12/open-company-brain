# Dynamic Architecture & Implementation Roadmap

> One prioritized plan for turning Company Brain from "fork & edit 2 files" into
> "configure & drop-in plugins" — sequenced by **dependency chain and leverage**,
> not by research stream. Quick wins first; the highest-cost work last and only
> on foundations laid earlier.

## How to read this

The work is sequenced into five phases. The ordering is driven by two facts:

1. **The feedback namespace is the fuel.** Almost every self-improvement loop
   reads from one canonical seam. Ship it first (hours).
2. **The manifest + registry + composition-root refactor is the multiplier.** It
   is "days," not "hours," but it must come early because it converts
   connector-breadth from core PRs into drop-in npm packages **and** is the
   prerequisite for per-tenant instantiation. Everything downstream gets cheaper
   once it exists.

Effort tags: **hours** (≤1 day), **days** (2–5 days), **weeks** (1–3 weeks) for a
solo/small team.

Repo facts below are verified against the current source (`src/config.ts`,
`src/db/datasource.ts`, `src/brain/memory.ts`, `src/graph/backend.ts`,
`src/brain/brain.ts`, `src/constants.ts`).

---

## Phase 0 — Ship this week (hours)

Lowest effort, immediate value, zero new seams. Do all four.

### 0.1 Feedback-as-Memory namespace — **hours** — *the fuel for everything*
- **Approach:** Mirror every terminal action signal (approved / rejected /
  edited-then-approved) as a first-class record
  `{query, retrieved_chunk_ids, generated_answer, verdict, scope, ts}` written
  through the **existing** `MemoryStore.upsert(docs)` under a reserved
  `feedback` namespace. Mock mode → JSON file; live mode → Langbase collection.
  Add a `FeedbackEvent` type and a `recordFeedback()` helper hung off the
  ActionStore status-transition hook that already has this data.
- **Extends:** `MemoryStore` (confirmed: `upsert(docs)` at `src/brain/memory.ts:39`)
  + the existing propose→approve→execute audit write path. No new store.
- **Why first:** Every other loop (reranker, few-shot, eval harvest) reads from
  this one seam. Verified viable — the upsert interface and namespace pattern
  already exist.

### 0.2 Approved-example few-shot — **hours**
- **Approach:** At generation time, embed the incoming query, retrieve 2–4
  nearest **approved** `(query, answer)` pairs from the `feedback` namespace via
  the same similarity search, and inject them into the Generator prompt as
  exemplars (dynamic k-NN few-shot / manual DSPy-BootstrapFewShot). Zero
  fine-tuning. **Gate exemplars by scope** (see cross-cutting risk). Bound by a
  max-token budget + dedupe.
- **Extends:** `Generator` — add an optional `exampleProvider` injected into the
  LangbasePipe/Mock prompt assembly. The provider is just a MemoryStore query;
  no new infra. Works identically for both generators.

### 0.3 One-click deploy buttons (Railway + Render) — **hours**
- **Approach:** Docker Compose already exists. Add `render.yaml` (Render
  Blueprint) + a Railway template referencing the existing Dockerfile; drop
  "Deploy to Railway/Render" badges in the README. The platform provisions
  Postgres + app + env in one click.
- **Extends:** existing docker-compose/Dockerfile and the env-driven
  auto-detect config (`src/config.ts:54,58`). Env vars become template secrets.
- **Payoff:** Forces the env-config layer to be the single deploy source of
  truth — hardening the config seam as the real pluggability control plane.

### 0.4 README-as-product — **hours**
- **Approach:** Rewrite the top fold around the differentiator: *"Open-source,
  self-hostable Glean/Dust alternative with a governed action layer and an FK
  knowledge graph — runs with zero creds in mock mode."* Add a comparison table
  (vs Glean/Dust/Thunai/Knowlee: self-hostable, open-source, action layer,
  governed approvals, swappable everything) and a single diagram of the
  swappable interfaces. **Keep the table honest about mock-vs-production-proven**
  (see risks).
- **Extends:** nothing — it markets the interface surface as the product claim,
  and the diagram doubles as the contribution map.

---

## Phase 1 — The dynamism multiplier (days) — do this early

This is the linchpin refactor. Three findings collapse into **one** coherent
change. Do it before connector breadth and before multi-tenancy, because both
depend on it. It introduces **no new heavy dependencies** — config is already Zod.

### 1.1 Typed manifest config (`company-brain.config.ts`) — **days**
- **Approach:** Add a `defineBrainConfig()` factory exported from a root config
  file. Extend the existing Zod schema (`src/config.ts`) so each seam field
  accepts **either** a built-in keyword
  (`postgres|seed|csv|json|mock|langbase|outbox|file|webhook`) **or** a live
  instance of the seam interface. Keep the current env→mode auto-detect
  (`src/config.ts:54,58`) as the fallback that synthesizes a default manifest
  when no config file exists, so zero-cred mock boot is unchanged. Loader
  precedence: **explicit config file > env auto-detect.** Validate eagerly with
  field-level errors.
- **Extends:** wraps the existing config object; manifest keys map 1:1 to the
  already-defined interfaces (`BrainDataSource`, `MemoryStore`, `Generator`,
  `GraphBackend`, `ActionExecutor`, `DeliverySink`, `ActionStore`).

### 1.2 Per-seam provider registries — **days**
- **Approach:** Each seam today is an interface + a hardcoded-switch factory:
  `createDataSource` (`src/db/datasource.ts:81`), `createMemoryStore`
  (`src/brain/memory.ts:166`), `createGraphBackend` (`src/graph/backend.ts:104`),
  plus action store/executor/sink. Introduce a minimal
  `Registry<TConfig, TInstance>` (a `Map<string, factory>`) per seam. Built-ins
  self-register at module load; each `createX()` becomes `registry.resolve(keyword, cfg)`.
  Third parties ship `company-brain-memory-pinecone`-style packages whose import
  registers a factory.
- **Critical:** Prefer an explicit `plugins: [pineconeMemory()]` manifest array
  over pure import side-effects — ESM tree-shaking can silently drop a
  registration that is never imported. Treat side-effect registration as
  convenience only.
- **Extends:** sits directly behind each existing factory; the manifest keyword
  path resolves through these registries instead of inline `if (kind === ...)`
  chains.
- **Payoff:** This single change converts the entire connector-breadth roadmap
  from core PRs into drop-in npm packages.

### 1.3 `createBrain(config)` composition root — **days**
- **Approach:** `Brain.create()` (`src/brain/brain.ts:44`) is currently no-arg
  and reaches into module-global config + the factories. Change it to
  `createBrain(cfg)` that resolves providers via the registries and threads
  shared deps (`pg.Pool`, logger, telemetry) through a `BrainContext`. Today the
  Postgres datasource and Postgres graph backend each open **their own** pool; a
  shared context lets them share one and makes the brain instantiable multiple
  times in-process with different configs.
- **Do NOT** add InversifyJS/tsyringe. Plain constructor injection from one
  explicit root is enough — this mirrors LangChain/LlamaIndex's deliberate
  avoidance of IoC containers. (See "What NOT to abstract.")
- **Watch:** `Brain.create()` closes the datasource in a `finally` block while
  the graph backend keeps its own pool open. A shared pool changes ownership —
  fix `close()` lifecycle so a shared pool isn't closed while still in use.
- **Payoff:** Multiple configs in one process = **the prerequisite for
  multi-tenancy (Phase 3).**

---

## Phase 2 — Breadth on the new seams (days)

Everything here is cheap *because* Phase 1 exists. These are parallelizable.

### 2.1 Generic `DocumentSource` seam — **days** — *the unstructured unlock*
- **Approach:** The current only path to memory goes through the rigid
  relational `BrainSnapshot`, which is the wrong shape for Slack/Drive/Notion.
  Add a parallel seam:
  ```ts
  interface DocumentSource {
    documents(opts?: { since?: string }): AsyncIterable<MemoryDocument> | Promise<MemoryDocument[]>;
    close(): Promise<void>;
  }
  ```
  Generalize `src/brain/sync.ts` so a run feeds the same `memory.upsert(docs)`
  from **either** a `BrainDataSource` (relational, unchanged) **or** a
  `DocumentSource` (documents directly). Each generic doc must populate the
  metadata contract from `constants.ts` (`META_SOURCE`, `META_RECORD_ID`,
  `META_KIND='document'`, `META_ACCESS`, `META_LAST_VERIFIED`) so provenance +
  multi-scope access keep working.
- **Extends:** `MemoryDocument` (`src/brain/documents.ts:30`) is the target;
  `runSync()` is the pipeline; registers as a `kind` via the Phase-1 registry.
- **Note:** Structured connectors (CSV/JSON/Postgres) stay untouched — this lane
  is purely additive.

### 2.2 `McpDocumentSource` — **days**
- **Approach:** One `DocumentSource` speaking Model Context Protocol via
  `@modelcontextprotocol/sdk` (same TS stack). Point it at any community/vendor
  MCP server (Slack, Google Workspace, Notion, Gmail). Normalize each tool
  result into a `MemoryDocument`. **One adapter, N connectors**; breadth grows as
  the MCP ecosystem grows, with zero framework changes.

### 2.3 `NangoDocumentSource` — **days**
- **Approach:** One adapter over Nango (TS-native, self-hostable, 400+
  connectors) for the OAuth-heavy long tail (Salesforce, Gmail, Drive at scale).
  Nango owns OAuth, token refresh, multi-tenant credential storage, incremental
  cursors, and **deletion detection** — things an OSS team should never
  hand-roll. Map deletion events → memory deletes; one Nango `connectionId` → one
  access scope.

### 2.4 Community connector convention — **days**
- **Approach:** Any npm package named `company-brain-connector-*` exporting
  `createConnector(config): DocumentSource` is auto-loadable by name from config.
  Ship a 30-line "write your own connector" guide. Keep LlamaHub/Unstructured.io
  file parsers as an **optional out-of-process** preprocessor only (they're
  Python — never a hard dep; see "What NOT to abstract").

### 2.5 Click-feedback Reranker + shared reward — **days**
- **Approach:** Insert an optional `Reranker` decorator between MemoryStore and
  Generator: `MemoryStore → Reranker → Generator`. Start heuristic, **zero ML
  deps**: `final = α·cosine + β·chunk_reward`, where `chunk_reward` is an EWMA of
  approval signal read from the `feedback` namespace. Graduate later to linear
  LTR (`ml-logistic-regression`, pure-JS) gated behind a minimum-sample count and
  shadow-evaluated before promotion. Optionally a `@xenova/transformers`
  cross-encoder as a drop-in upgrade. Define **one normalized scalar reward**
  (`w1·explicit + w2·implicit + w3·judge`) stored on `FeedbackEvent` so the
  reranker, few-shot selector, and eval harvest all optimize the same currency.
  Add ~30 lines of epsilon-greedy exploration to avoid feedback-loop ossification.
- **Extends:** new pluggable `Reranker` seam, identity/null by default (mock mode
  unchanged). Retrieval quality now compounds with usage without touching the
  MemoryStore backend.

### 2.6 Scaffolder + runnable examples + hosted playground — **days**
- `create-company-brain` (`npm create company-brain@latest`) — thin scaffolder
  (like create-t3-app). Asks connector type, emits a **working starter adapter +
  config + seed data**, not a clone. One runtime package, one scaffolder.
- `examples/` recipes: support-ticket brain (CSV), sales-CRM brain (Postgres),
  docs brain (JSON) — each ~1 adapter file + README + seed, runnable in mock
  mode, each shipping eval cases. Plus a CONTRIBUTING "add a connector in <50
  lines" funnel.
- **Hosted zero-cred playground:** embed mock-mode in a StackBlitz WebContainer
  (or Railway free tier) behind a "Try it, no signup" README button. Mock-mode
  only (no Postgres in WebContainers) — label it clearly. **CI-gate it against
  the eval harness** so the demo never breaks.

---

## Phase 3 — Scale & multi-tenancy (days → weeks)

**Depends on Phase 1.3:** RLS and per-tenant config cannot be planned until the
brain is instantiable per-tenant via `createBrain(config)`. Lean entirely on the
Postgres that live mode already requires — add zero new infrastructure.

### 3.1 Row-Level Security + `withTenant()` — **days**
- **Approach:** Add `tenant_id uuid` to every Postgres-backed table (ActionStore,
  graph nodes/edges, sync state). One RLS policy per table:
  `USING (tenant_id = current_setting('app.tenant_id')::uuid)`. Wrap every pool
  checkout in `withTenant(tenantId, fn)` that runs `SET LOCAL app.tenant_id`
  **inside a transaction** (`SET LOCAL`, never `SET` — see risk) before any
  query. Default tenant `'default'` keeps single-tenant/mock unchanged.
- **Extends:** all Postgres stores share one pool, so this is one shared wrapper.
  Isolation becomes a pluggable `IsolationStrategy` seam (`rls` default).

### 3.2 `JobQueue` seam with pg-boss — **days**
- **Approach:** Adopt **pg-boss** (not BullMQ — it forces Redis on every
  self-hoster). pg-boss lives in the **same** Postgres and ships retries,
  scheduling, dead-letter, and singleton/dedupe keys. Thin `JobQueue` interface
  with two drivers: `MockJobQueue` (in-process, inline — keeps zero-cred mode
  working) and `PgBossJobQueue` (live). Move incremental sync, embedding
  generation, action execution, and webhook delivery onto named queues.
- **Extends:** mirrors the existing mock/live driver pattern exactly. ActionExecutor
  and DeliverySink become job handlers. Interface exists precisely so a high-scale
  fork can swap BullMQ/SQS without rewrites.

### 3.3 Queue idempotency + per-tenant rate limit + config overlay — **days**
- **Idempotency:** pass `singletonKey` (`${tenantId}:${actionId}`) on every
  enqueue; for external side-effects add a `processed_keys` table with a unique
  constraint checked-and-inserted **in the same transaction** as the side-effect
  commit. (Truly external webhooks remain at-least-once — document that consumers
  must tolerate retries.)
- **Rate limit:** `rate-limiter-flexible` (memory backend mock, Postgres/Redis
  live) on three choke points keyed by `tenantId`: ingestion, generator calls,
  action execution.
- **Config overlay:** a two-level resolver `env → tenant → request` with a
  **bounded TTL** (stale tenant config = revoked-scope security gap). Tenant
  records sourced via the existing Seed/JSON/CSV connector shapes.

### 3.4 Eval-harvest CLI — **days**
- **Approach:** `companybrain evals:harvest` scans the `feedback` namespace and
  promotes high-signal events into eval cases — approved → golden positives,
  rejected/edited → regression cases. Dedupe by query-embedding similarity. Reuse
  the existing Generator as an LLM-as-judge to auto-write assertions. **Require a
  human approve flag** before a case enters fixtures (judge is self-referential —
  see risks).
- **Extends:** existing eval harness + setup CLI. The eval suite becomes a living
  regression net that grows from real usage.

---

## Phase 4 — Highest cost, deferred-but-planned (weeks)

### 4.1 Schema-driven entities — **weeks** — *do NOT pull forward*
- **Approach:** The biggest "edit a file" problem: `domain/types.ts` hand-defines
  5 interfaces, `adapter/index.ts` hand-writes SQL + mappers, `documents.ts`
  hand-writes per-entity templaters, and **graph edges are hardcoded in TWO
  places** (`src/graph/relationships.ts` `buildGraph` **and** the recursive CTE
  in `src/graph/backend.ts`). Introduce an `entities[]` manifest block
  (`{name, table, primaryKey, fields, relations, embedTemplate, accessField}`).
  A generic `SchemaAdapter` replaces bespoke mappers; a generic
  `entityToDocument` replaces the three templaters; graph edges **derive** from
  `relations` for both the in-memory builder and the CTE generator. Validate with
  Zod; codegen TS types (Prisma/Payload style) with a CI freshness check.
- **Why last:** It touches the most files and the hardest seam, and it needs the
  registry/manifest foundation (Phase 1) first. **Keep a custom-mapper /
  custom-embedTemplate escape hatch** so hand-tuned cases (access-scoped child
  filtering in `documents.ts`, theme enrichment) never force a fork — a naive
  generic templater would silently weaken the security/quality contract.

---

## Making the architecture dynamic

The mechanical core of "fork & edit 2 files" → "configure & drop-in plugins" is
**three layered refactors**, all in Phase 1, none introducing heavy deps:

1. **Manifest, not env-only.** `company-brain.config.ts` with a `defineBrainConfig()`
   factory. Fields accept a keyword **or** a live instance. Env auto-detect stays
   as fallback. This is the import point for third-party plugins.
2. **Provider registries, not switches.** One `Map<string, factory>` per seam
   replaces every hardcoded `createX()` switch. Built-ins self-register; community
   packages register on import. **Primary path is an explicit `plugins: []`
   array** — never rely on import side-effects alone (ESM tree-shaking drops
   them).
3. **One composition root, not module globals.** `createBrain(config)` resolves
   providers via registries and injects shared deps (`pg.Pool`, logger) through a
   `BrainContext`. Plain constructor injection.

Two more dynamic surfaces, layered on top:

4. **Two ingestion lanes behind one sink.** The `DocumentSource` seam (Phase 2.1)
   makes "breadth" a plugin problem: structured (relational FK graph) and
   unstructured (documents) both feed `memory.upsert`. New connectors require zero
   core edits.
5. **Schema-driven domain (Phase 4, deferred).** The same `entities[]`
   declaration drives mapping, embedding, graph edges, and access scopes — one
   source of truth replacing four hand-synced files. High payoff, high cost,
   **explicitly last.**

### What should NOT be abstracted

Pragmatism guardrails — these are deliberate non-goals, not oversights:

- **No IoC container** (InversifyJS/tsyringe). Plain constructor injection from
  one explicit root. LangChain and LlamaIndex deliberately avoid IoC to stay
  un-bloated; so do we.
- **No schema-per-tenant / db-per-tenant now.** RLS is the default and only
  built isolation tier. Schema/db isolation are **documented escape hatches** for
  rare enterprise forks — reserved, not built.
- **No Python in the hot path.** LlamaHub / Unstructured.io are Python; wiring
  them as a hard dep breaks the single-stack simplicity that drives adoption.
  Expose only as an **optional out-of-process** parsing shim.
- **No clone-generator.** One runtime package + one **thin** scaffolder that
  emits config/adapter glue. Not a `create-app` that forks the whole core.
- **No premature schema-driven entities.** Until the registry/manifest foundation
  exists and there's real demand, the hand-written domain model is fine. Forcing
  it into quick-wins is the exact over-engineering failure mode to avoid.
- **No new infrastructure for the queue.** pg-boss reuses the existing Postgres.
  Do not introduce Redis/BullMQ as a default — keep it behind the `JobQueue` seam
  for forks that need it.

---

## Adoption playbook

Highest-leverage DX/deploy/docs moves, in priority order. Every one is also a live
demonstration of the swappable-interface thesis, so adoption work hardens the
architecture rather than competing with it.

1. **Lead with a running instance (hours–days).** A hosted zero-cred mock-mode
   playground ("Try it, no signup") is the single biggest TTFV lever for an OSS
   framework in 2026 — the visitor never installs anything. Pair with a 30-second
   `vhs` terminal gif of `npx`-to-query in the README's first screen.
2. **One-click deploy (hours).** Railway + Render buttons turn the hardest part of
   self-hosting (wiring Postgres + env) into a click. Hours of YAML, not a build.
3. **README-as-product (hours).** "Open-source Glean/Dust alternative" headline +
   honest comparison table + one architecture diagram. Positioning against named
   incumbents (cf. Cal.com/Calendly, Plausible/GA, Supabase/Firebase) is the
   strongest SEO + judgment shortcut.
4. **Scaffolder over docs (days).** `npm create company-brain@latest` makes the
   adapter seam — the #1 friction point — the documented day-one entry point with
   a generated, working adapter per connector type.
5. **Runnable recipes (days).** `examples/` per domain, each ~1 file + seed +
   eval cases, all runnable in mock mode. Developers copy working examples far
   more than they read prose. The "add a connector in <50 lines" guide turns the
   connector seam into a contribution funnel.
6. **CI-gate every demo and deploy.** A broken playground or a deploy button that
   provisions a failing stack is worse than none. Gate all of them against the
   eval harness so "try it" always works.

**Conversion guardrail:** mock-mode demos win stars but can mask that **live mode
(Langbase + Postgres + real embeddings) is the genuinely hard, less-proven path.**
Treat "prove live embeddings end-to-end + push users from mock demo to live
deploy" as an explicit adoption metric, not an afterthought.

---

## Top risks & what to explicitly defer

### Cross-cutting risk #1 — Access-scope leakage (one thread through three streams)
Scope isolation is enforced by a **string-key agreement on `META_ACCESS`** across
both `MockMemoryStore` and `LangbaseMemoryStore` (`src/brain/memory.ts:75,162`;
key at `src/constants.ts:11`). The same correctness thread runs through:
- **Few-shot exemplars** — approved `(query, answer)` pairs must be scope-filtered
  at retrieval or one tenant's answers leak into another's prompt.
- **Unstructured connectors** — each source's native ACL → `AccessScope` mapping
  is the hardest correctness problem; must be explicit per-adapter, never defaulted
  to `default-team`.
- **Langbase per-tenant isolation** — RLS isolates Postgres but **not** the
  external Langbase/Pipes services; those need per-tenant namespacing/memory
  partitions or vector recall crosses tenants even when SQL is isolated.

**Mitigation:** treat `META_ACCESS` as one inviolable end-to-end seam. Any
schema-driven `accessField` indirection must preserve the exact key. Test **both**
memory stores after any change here.

### Risk #2 — RLS connection-leak footgun
Using `SET` instead of `SET LOCAL`, or setting the GUC outside a transaction,
leaks the tenant id onto a pooled connection and cross-contaminates tenants — the
most dangerous RLS bug. The `withTenant()` wrapper must always be
transaction-scoped and is the single point to review/test hard. Also: table-owner
roles **bypass RLS** by default — the app must connect as a non-owner role with
`FORCE ROW LEVEL SECURITY`, or isolation silently does nothing.

### Risk #3 — Feedback loops ossify
A reranker/few-shot system that only learns from what it surfaced entrenches early
bias and starves novel-but-correct content. **Mitigate with epsilon-greedy
exploration + periodic eval-set audits**, or the system degrades while looking like
it improves. Sparse/skewed thumbs data also overfits a learned LTR model fast —
keep heuristic + similarity as a strong baseline and gate the learned model behind
a minimum-sample count with shadow evaluation.

### Risk #4 — LLM-as-judge is self-referential
Using the same Generator to grade its own outputs can rubber-stamp errors. Require
human approval before a harvested case enters fixtures; periodically spot-check
judge agreement against human labels.

### Risk #5 — Registry registration silently dropped by bundlers
ESM tree-shaking can drop a side-effect-only registration. The explicit
`plugins: []` manifest array is the primary path; side-effects are convenience.

### Explicitly defer
- **Schema-per-tenant and db-per-tenant** isolation — documented escape hatches
  only.
- **Schema-driven entities (Phase 4)** — until the manifest/registry foundation
  ships and demand is real.
- **Cross-encoder / trained LTR reranker** — heuristic reward first; graduate only
  after data accumulates.
- **BullMQ/SQS queue drivers** — interface now, drivers only for forks that need
  them.
- **Graph enrichment of unstructured docs** — v1 unstructured ingestion is
  **RAG-only, not graph-connected** (pure documents have no FK edges). Set this
  expectation explicitly; entity-extraction is a later, separate effort.
- **Per-source incremental cursors** — the current watermark is a single
  `max(updatedAt)` string; document sources have heterogeneous cursors. Migrate to
  per-source state in `.brain-state.json` only when the first such connector lands.
- **Live-deployment `tenant_id` backfill migration** — needs a careful, reversible
  default-tenant backfill path; plan it as part of Phase 3, not retrofitted under
  time pressure.
