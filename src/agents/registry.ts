/**
 * Custom agents — no-code, runtime-defined agents.
 *
 * A "read agent" is just an instruction (a prompt) plus what to retrieve. The
 * Brain already exposes that shape via `draft(query, instruction, scopes)`:
 * retrieve grounded chunks, then generate under the instruction. So a user can
 * define and run an agent from the dashboard with zero code — and it inherits
 * citations and the cite-or-refuse contract for free.
 *
 * This store holds the *definitions* (name + instruction + retrieval query).
 * It is deliberately the same in-memory-default + process-singleton shape as the
 * feedback store, so it works in mock mode with zero setup and swaps to a
 * Postgres-backed impl later. Definitions are prompt templates, not records —
 * the access boundary is enforced when an agent RUNS (Brain.draft is scoped).
 */

export interface CustomAgent {
  id: string;
  name: string;
  /** The instruction the model follows (the user's prompt). */
  instruction: string;
  /** What to retrieve for grounding (defaults to the run-time question). */
  query: string;
  createdAt: string;
}

export interface CustomAgentStore {
  save(input: { name: string; instruction: string; query?: string }): Promise<CustomAgent>;
  list(): Promise<CustomAgent[]>;
  get(id: string): Promise<CustomAgent | undefined>;
}

let counter = 0;
const nextId = (): string => `agent_${++counter}_${process.pid}`;

export class InMemoryCustomAgentStore implements CustomAgentStore {
  private agents: CustomAgent[] = [];

  async save(input: { name: string; instruction: string; query?: string }): Promise<CustomAgent> {
    const agent: CustomAgent = {
      id: nextId(),
      name: input.name.trim(),
      instruction: input.instruction.trim(),
      query: (input.query ?? input.name).trim(),
      createdAt: new Date().toISOString(),
    };
    this.agents.push(agent);
    return agent;
  }

  async list(): Promise<CustomAgent[]> {
    return [...this.agents];
  }

  async get(id: string): Promise<CustomAgent | undefined> {
    return this.agents.find((a) => a.id === id);
  }
}

let singleton: CustomAgentStore | null = null;
/** Process-wide store so the API and the dashboard share one registry. */
export function getCustomAgentStore(): CustomAgentStore {
  if (!singleton) singleton = new InMemoryCustomAgentStore();
  return singleton;
}
