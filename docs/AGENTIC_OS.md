# Open Brain as an Agentic OS Harness — research & architecture

> Research brief answering: *how do we build this as an agentic OS harness — bring
> any agent, connect any MCP, build on top of it — and be genuinely better than
> what exists?*

## 1. The landscape (what already exists, and where the gap is)

| Project | What it centers on | Limitation for our goal |
|---|---|---|
| **Hermes Agent** (Nous Research, 2026; ~140k★) | one self-hosted, self-improving agent that "grows with *you*"; persistent memory, cron, sub-agents, 16+ chat platforms | **agent-centric, single-user.** Memory serves the agent. No org-grade access governance, no "bring *any* agent", not a substrate others build on. |
| **Letta / MemGPT** | OS-inspired *memory* tiers (core/archival/recall) for a stateful agent runtime | memory is the product, for an agent. Not a governed multi-agent org substrate; not a tool/MCP fabric. |
| **AIOS** (academic, COLM 2025) | the *reference architecture*: an LLM-agent OS kernel — scheduler, context, memory, storage, tool, **access** managers | a paper/runtime, not a governed product with cite-or-refuse + an MCP host + shells. |
| **LangGraph / CrewAI / AutoGen / Microsoft Agent Framework** | agent *frameworks* (how to build one agent's logic) | you build the agent; they don't govern a fleet over shared, access-controlled knowledge. (2026's "agent harness" trend is exactly the control plane *around* these.) |
| **Dify / Flowise** | low-code agent builders | builder UX, not a governed OS kernel + MCP fabric. |

**The 2026 shift the field agrees on:** the value is no longer "another agent" — it's the **harness** (the control plane that *governs* agents: lifecycle, context, tool access, budget, approval, audit), and it should be **framework-agnostic** ("bring your own agent"). And MCP has become the standard way to give agents tools — an MCP **host** can connect *many* MCP servers and aggregate their tools.

**Our opening (the differentiation):**
> Everyone else is *agent-centric and single-user*. We are **governance-centric, multi-agent, and organizational**: a governed knowledge **kernel** + an **agent harness** (bring any agent) + an **MCP tool fabric** (connect any MCP, incl. your own knit) + **org access control + cite-or-refuse provenance + audit**. You don't bring your data to our agent — you bring **any agent (and any tools)** to your governed brain.

## 2. Target architecture (AIOS kernel + harness control-plane + MCP fabric)

```
  SHELLS        Dashboard        HTTP API        MCP server (we are a server)
                    │                │                │
  ───────────────────────────────────────────────────────────────────────────
  HARNESS   ┌───────────────────────────────────────────────────────────────┐
  (control  │  per-run governance wrapped around EVERY agent:                │
   plane)   │  scope enforcement · tool allow-list · cost/step budget ·      │
            │  human-in-the-loop approval · full audit · grounding           │
            │                                                                │
            │  Agent adapters (BRING ANY AGENT):                             │
            │   • Builtin (our generator)  • MCP-host loop  • LangGraph/     │
            │     CrewAi/Hermes via process/API adapter                      │
            └───────────────────────────────────────────────────────────────┘
  ───────────────────────────────────────────────────────────────────────────
  TOOL      ┌───────────────────────────────────────────────────────────────┐
  FABRIC    │  unified, namespaced tool registry =                          │
            │   brain tools (search/ingest)  ⊕  action layer                │
            │   ⊕  CONNECTED MCP SERVERS (we are also an MCP *host*:         │
            │       knit, filesystem, github, … aggregated + scope-gated)   │
            └───────────────────────────────────────────────────────────────┘
  ───────────────────────────────────────────────────────────────────────────
  KERNEL    governed brain: embed · access-scoped retrieval · cite-or-refuse ·
            provenance · feedback/learning · scheduler (events + cron)
  ───────────────────────────────────────────────────────────────────────────
  STORE     pgvector / Langbase  (one shared store behind every shell)
```

Mapping to the AIOS kernel managers (so we're principled, not ad-hoc):
- **memory + storage + access managers** → ✅ already built (the kernel: pgvector, scopes, provenance, cite-or-refuse). *This is our moat and it's done.*
- **tool manager** → **build the Tool Fabric**: an MCP **host/aggregator** that connects external MCP servers, namespaces their tools (`knit.search`, `github.create_issue`), and merges them with brain + action tools — all scope-gated.
- **scheduler** → extend fan-out (event-driven, ✅) with **cron/scheduled agents** + a run queue.
- **context manager** → context blocks ✅; add snapshot/restore for long-running agents.
- **agent runtime (application layer)** → **the Harness**: a pluggable `Agent` interface + adapters so any framework runs on top, each run governed.

## 3. What we already have vs. the gap

**Have (the hard, differentiating part):** governed kernel (ingest → scoped retrieval → cite-or-refuse → feedback), three shells (dashboard/HTTP/MCP-server), built-in agents (ask/draft/no-code), event-driven fan-out, human-approved action layer, three backends, library embed.

**Gap (to become a true harness):**
1. **MCP host/client + Tool Fabric** — connect external MCP servers (knit, etc.), aggregate+namespace their tools, expose them (scope-gated) to agents. *Turns "we are an MCP server" into "we also host any MCP."*
2. **Agent adapter interface (bring your own agent)** — `Agent.run(task, ctx)` with adapters: builtin, an MCP-host tool-loop agent, and an external-process/API adapter (LangGraph/CrewAI/Hermes).
3. **Harness governance wrapper** — one place enforcing scope + tool allow-list + cost/step budget + approval + audit around *every* agent run (the 2026 control-plane pattern).
4. **Scheduler** — cron/scheduled agents + a run/queue model (AIOS scheduler; Hermes parity).
5. **Agent registry & runs UI** — the OS "installed apps" + a run log/observability view.

## 4. Build roadmap (each phase shippable, kernel stays the contract)

- **K1 — Tool Fabric / MCP host.** `src/tools/` registry + an MCP client that connects configured external MCP servers, lists+namespaces their tools, and a `call_tool` path. Expose the merged toolset to agents; scope-gate every call. (Highest-leverage: this is "connect any MCP incl. knit".)
- **K2 — Agent adapter interface.** `src/harness/agent.ts` (`Agent.run`), a Builtin adapter (today's brain), and an MCP-host tool-loop adapter (model + Tool Fabric). One registry of agents.
- **K3 — Harness governance wrapper.** Per-run scope/tool-allowlist/budget/approval/audit around every `Agent.run`. Reuse the action layer's approve+audit.
- **K4 — Scheduler.** Cron + event triggers feeding a run queue (generalize fan-out).
- **K5 — External-runtime adapter.** Run a LangGraph/CrewAI/Hermes agent as a governed process on the OS (bring-your-own-agent, proven).
- **K6 — Agents + runs UI.** Installed-agents home + run/observability log in the dashboard.

## 5. Principles that keep it "better and proper"
- **Governance is non-negotiable and lives in the kernel** — every agent and every tool call inherits scope + cite-or-refuse + audit. That's the thing competitors don't have.
- **Framework-agnostic harness** — never lock to one agent framework; adapt at the edge.
- **MCP both ways** — we are an MCP *server* (others use our brain) *and* an MCP *host* (our agents use others' tools, incl. knit).
- **Org-first, not single-user** — multi-scope access control is a first-class primitive, not an afterthought.

## Sources
- AIOS: LLM Agent Operating System — https://arxiv.org/abs/2403.16971 ; https://openreview.net/forum?id=L4HHkCDz2x
- Agent harnesses (2026 control-plane) — https://dev.to/htekdev/agent-harnesses-why-2026-isnt-about-more-agents-its-about-controlling-them-1f24 ; https://atlan.com/know/how-to-build-ai-agent-harness/ ; https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-at-build-2026-announce/
- Awesome harness engineering — https://github.com/ai-boost/awesome-harness-engineering
- MCP host / multi-server aggregation — https://itnext.io/multi-mcp-exposing-multiple-mcp-servers-as-one-5732ebe3ba20 ; https://github.com/lastmile-ai/mcp-agent ; https://www.truefoundry.com/blog/virtual-mcp-server
- Hermes Agent (Nous Research) — https://hermes-agent.nousresearch.com/ ; https://github.com/nousresearch/hermes-agent
- Letta / MemGPT — https://github.com/letta-ai/letta ; https://docs.letta.com/concepts/memgpt/
- Agent memory landscape 2026 — https://agentmarketcap.ai/blog/2026/04/10/agent-memory-vendor-landscape-2026-letta-zep-mem0-langmem
