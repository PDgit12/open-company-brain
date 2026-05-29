/**
 * The Brain service — the orchestration layer the API and CLI call.
 *
 * It wires together the four pieces we designed:
 *   data source → recall (memory) + graph → generation
 *
 * Two public agents:
 *   • brief(companyName)  — a partner briefing (read-only, the v0 wedge).
 *   • ask(question)       — grounded Q&A over the whole brain.
 *
 * Both are access-scoped: a caller only ever sees chunks their scopes allow.
 */

import { createDataSource } from '../db/datasource.js';
import { createMemoryStore, type MemoryStore, type RetrievedChunk } from './memory.js';
import { createGenerator, type Generator } from '../agents/generator.js';
import { snapshotToDocuments } from './documents.js';
import {
  buildGraph,
  findIntroPath,
  type CompanyGraph,
  type Path,
} from '../graph/relationships.js';
import {
  buildContextBlock,
  buildBriefingPrompt,
  buildAskPrompt,
} from '../agents/prompts.js';
import type { BrainSnapshot } from '../domain/types.js';

export interface BrainAnswer {
  answer: string;
  /** The records that grounded the answer — for the "show your sources" UI. */
  sources: RetrievedChunk[];
  introPath?: Path | null;
}

export class Brain {
  private constructor(
    private readonly memory: MemoryStore,
    private readonly generator: Generator,
    private readonly snapshot: BrainSnapshot,
    private readonly graph: CompanyGraph,
  ) {}

  /** Build the brain: load source-of-truth, sync it into recall, build the graph. */
  static async create(): Promise<Brain> {
    const dataSource = createDataSource();
    try {
      const snapshot = await dataSource.loadSnapshot();
      const memory = createMemoryStore();
      await memory.upsert(snapshotToDocuments(snapshot));
      const graph = buildGraph(snapshot);
      return new Brain(memory, createGenerator(), snapshot, graph);
    } finally {
      await dataSource.close();
    }
  }

  private findCompanyId(name: string): string | undefined {
    const lower = name.toLowerCase();
    return this.snapshot.companies.find(
      (c) => c.name.toLowerCase() === lower || c.name.toLowerCase().includes(lower),
    )?.id;
  }

  async brief(companyName: string, accessScopes: string[]): Promise<BrainAnswer> {
    const chunks = await this.memory.retrieve({
      query: `${companyName} partnership history recent engagements open actions contacts`,
      accessScopes,
      topK: 10,
    });
    const context = buildContextBlock(chunks);
    const prompt = buildBriefingPrompt(companyName, context);
    const answer = await this.generator.generate({ prompt, chunks });
    return { answer, sources: chunks };
  }

  async ask(question: string, accessScopes: string[]): Promise<BrainAnswer> {
    const chunks = await this.memory.retrieve({ query: question, accessScopes, topK: 8 });
    const context = buildContextBlock(chunks);
    const prompt = buildAskPrompt(question, context);
    const answer = await this.generator.generate({ prompt, chunks });
    return { answer, sources: chunks };
  }

  /** Graph query exposed directly: warm-intro path between two companies. */
  introPath(fromCompany: string, toCompany: string): Path | null {
    const from = this.findCompanyId(fromCompany);
    const to = this.findCompanyId(toCompany);
    if (!from || !to) return null;
    return findIntroPath(this.graph, from, to);
  }

  /** Names the brain knows about — handy for demo UIs and autocomplete. */
  companyNames(): string[] {
    return this.snapshot.companies.map((c) => c.name);
  }
}
