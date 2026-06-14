# Comb demo — the governed loop, not a search box

The data lives in `./demo-company/` (7 policy + ops files for a fictional fintech,
"Larkspur"). This walkthrough is kept OUT of that folder on purpose, so ingesting
the folder ingests only real company data.

The point of this demo is the thing **a pile of `.md` files and a search box
cannot do**: scoped answers, recorded procedures, declared intent, divergence
flagged into a human-approved action, and a loop that learns from outcomes.

## 0. Connect it to your AI tool (one command)
```bash
npm i -g open-company-brain          # or: npm link, from this repo
comb install claude                  # or cursor | vscode | claude-code | windsurf
```
That writes the MCP config (model-free, your-data-only) and prints a shared brain
path. Use that same `COMB_DATA_DIR` below so the tool and CLI share one brain.

```bash
export COMB_DATA_DIR="$HOME/.comb-brain"
```

## 1. Declare intent FIRST — what *should* be true
Divergence is detected at ingest time against intents that already exist, so
declare them before you ingest reality:
```bash
comb intent "Refunds over 10000 dollars require VP sign-off" --kind policy
comb intent "Wires over 50000 dollars are reconciled the same business day" --kind policy
comb intent "No standing (non-expiring) access to the payments database" --kind policy
```

## 2. Ingest the company (folder ingest, your data only — no demo seed)
```bash
comb ingest ./examples/demo-company --source larkspur --scope default-team
```
As the daily ops log lands, Comb keyword-matches it against your intents and
records the overlaps as divergence candidates — model-free, no model needed.

## 3. Retrieval that cites — or refuses (table stakes, but honest)
From your AI tool (Claude/Cursor), or the CLI:
```bash
comb run --agent builtin "who must approve a refund over 10000 dollars" --scopes default-team
```
→ grounded answer citing `refund-policy`. Ask about something not in the brain →
it **refuses** rather than inventing.

## 4. The loop: surface candidates, let the agent judge (Obsidian can't do this)
```bash
comb divergences
```
→ Comb keyword-matches new data against each intent and lists the **candidates**:
content that *topically overlaps* an intent. This is deliberately coarse and
model-free — it surfaces what's worth a look (including, honestly, the policy docs
themselves, since they share the topic). It does **not** decide what's a violation.

That judgment is the host's job, and it's where the value is: from your AI tool,
the agent calls `list_divergence_candidates`, reads the ops-log entry
("issued a $15,000 refund without VP sign-off"), compares it to the refund intent,
and concludes *this one is a real divergence* — then drafts the alert with
`submit_action`. Comb surfaces and governs; the connected model reasons. The CLI
shows you the candidates; the agent turns them into judged, approved action.

## 5. Skills — the *how*, not just the *what*
```bash
comb skill "Handle a refund request" --body "verify txn → check threshold → VP sign-off if >10k → credit original method" --triggers refund,return,credit
comb skills "customer wants their money back"     # trigger-matched, scoped
```

## 6. Close the loop on the outcome (the rung almost no one builds)
```bash
comb actions                       # what awaits approval
comb approve <id>                  # executes + delivers + audits (idempotent)
```
Then report what actually happened so the brain re-weights the records that
produced a good action — via the `record_outcome` MCP tool, e.g.
`record_outcome(<id>, converted, "VP confirmed and corrected the refund")`.

## 7. Watch it improve — eval + run history
```bash
comb eval            # grounds · refuses · tool-use · scope — measured, not vibes
comb runs            # every run: tokens · latency · tools · status
```

## Why this isn't reproducible with Obsidian + markdown
Search gives you step 3. Steps 1, 2, 4, 6, 7 — declared intent, divergence into a
human-approved action with an audit trail, and a reward that re-ranks retrieval
from real outcomes — are governance and a closed loop, owned per company. The
markdown is just the seed.
