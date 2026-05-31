# Getting Started (5 minutes)

Stand up your own Company Brain, then make it yours. Each step is copy-paste.

## 1. Scaffold + run (mock mode, no keys)

```bash
npx degit PDgit12/open-company-brain my-brain
cd my-brain && npm install
npm run demo            # → http://localhost:4000
```

You now have a working brain on synthetic data. Click around: **Brief me**, **Ask**,
**relationship path**, **draft an action**.

## 2. Go live — pick a backend

**Option A — managed (Langbase):**
```bash
npm run init            # paste your Langbase key (Enter to skip), optional Postgres URL
npm run setup:live      # provisions the Memory + Pipe, then syncs
npm run doctor          # confirms the active mode
```
> Managed recall needs an embedding-provider key (e.g. OpenAI/Google) set **in your
> Langbase account** — separate from any LLM key. `doctor` reminds you.

**Option B — fully local ($0 per query):** Ollama + pgvector, nothing hosted.
```bash
ollama serve & ollama pull llama3.2:1b nomic-embed-text
docker compose up -d                 # Postgres + pgvector (host port 5433)
export LLM_BACKEND=local
export VECTOR_DATABASE_URL=postgres://brain:brain@localhost:5433/company_brain
npm run setup:local                  # pulls models if needed + embeds your data
npm run demo                         # /health → recall=local generation=local
```

## 3. Point it at your data

Two files, nothing else:

- **`src/domain/types.ts`** — rename/replace the example entities with yours.
- **`src/adapter/index.ts`** — the SQL that reads *your* tables + the mappers that
  shape your rows. Keep the SELECT aliases stable and the rest of the app doesn't move.

Then:

```bash
npm run seed:db   # optional: load the example schema locally
npm run sync      # build the recall layer from your data
```

## 4. Add your own workflow (an "action recipe")

A workflow here is a **prompt + an executor** — it inherits grounding, human
approval, idempotency, and audit for free. See a complete, copyable template in
[`examples/custom-action.example.ts`](../examples/custom-action.example.ts).

The shape:

```ts
// 1) say what to execute (ActionExecutor)
// 2) propose it grounded in the brain (service method)
// 3) approve() runs it once, audited
```

## 5. Verify

```bash
npm test          # 56 tests
npm run eval      # behavioural golden set (grounds when it should, refuses when it must)
```

That's it. Mock for development, live with your keys, your data, your workflows.

---

**Where to go next:** `ARCHITECTURE.md` (the seams and the two contracts),
`ROADMAP.md` (what's deferred and when to build it).
