/**
 * THE DIVERGENCE ENGINE (MVP) — the loop's COMPARE stage (ARCHITECTURE §11.5).
 *
 * On every ingest, each enabled Intent in scope is checked against the new
 * reality: "does this new data indicate drift from what should be happening?"
 * The verdict is a typed, validated DivergenceRecord — the AnswerRecord
 * pattern's third stamp:
 *
 *   diverged            → evidence-cited flag → an approvable action is
 *                         proposed (the ADJUST stage; by='divergence-engine')
 *   aligned             → SILENCE (recorded, never surfaced as a flag)
 *   insufficient_signal → SILENCE (the calibrated default — alert fatigue is
 *                         this category's killer; we flag only with evidence)
 *
 * The model caller is INJECTED (same Llm seam as structured.ts) so the engine
 * is hermetically testable; production wires grammar-constrained Ollama and
 * SKIPS (insufficient) on non-local backends rather than guessing.
 */

import path from 'node:path';
import { config } from '../config.js';
import { postJson } from '../harness/http.js';
import { JsonFileCollection } from '../storage/json-file.js';
import { getIntentStore, type Intent } from '../intents/registry.js';
import { ActionService } from '../actions/service.js';
import type { Llm } from '../brain/structured.js';
import type { Brain } from '../brain/brain.js';

export type DivergenceStatus = 'diverged' | 'aligned' | 'insufficient_signal';

export interface DivergenceRecord {
  id: string;
  status: DivergenceStatus;
  intentRef: string; // Intent id — a flag ALWAYS cites what it diverged from
  intentStatement: string;
  /** The new-data excerpt that evidences the verdict (empty unless diverged). */
  evidence: string[];
  rationale: string;
  source: string;
  scope: string;
  at: string;
  /** Set when a diverged flag became an approvable action. */
  actionId?: string;
}

export const DIVERGE_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['diverged', 'aligned', 'insufficient_signal'] },
    evidence: { type: 'array', items: { type: 'integer' } },
    rationale: { type: 'string' },
  },
  required: ['status', 'evidence', 'rationale'],
} as const;

/** Validate a model verdict. Null = invalid → treated as insufficient_signal. */
export function parseDivergence(
  text: string,
  itemCount: number,
): { status: DivergenceStatus; evidence: number[]; rationale: string } | null {
  try {
    const r = JSON.parse(text) as { status?: unknown; evidence?: unknown; rationale?: unknown };
    if (r.status !== 'diverged' && r.status !== 'aligned' && r.status !== 'insufficient_signal') return null;
    if (!Array.isArray(r.evidence) || typeof r.rationale !== 'string') return null;
    const ev: number[] = [];
    for (const n of r.evidence) {
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > itemCount) return null;
      if (!ev.includes(n)) ev.push(n);
    }
    // The enforcement invariant: a flag without evidence is NOT a flag.
    if (r.status === 'diverged' && (ev.length === 0 || !r.rationale.trim())) return null;
    return { status: r.status, evidence: ev, rationale: r.rationale.trim() };
  } catch {
    return null;
  }
}

function comparePrompt(intent: Intent, items: string[]): string {
  const list = items.map((t, i) => `ITEM ${i + 1}: ${t.replace(/\s+/g, ' ').slice(0, 500)}`).join('\n\n');
  return `INTENT (${intent.kind} — what SHOULD be happening): ${intent.statement}

NEW DATA just observed:
${list}

Does the new data indicate the company is DRIFTING from this intent?
- "diverged" ONLY if specific items contradict or endanger the intent — cite them in evidence (e.g. [1]).
- "aligned" if the data supports or matches the intent.
- "insufficient_signal" if the data simply isn't about this intent (the COMMON case — do not stretch).
Reply ONLY with JSON: {"status": "...", "evidence": [item numbers], "rationale": "one sentence"}`;
}

const nextId = (): string => `div_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Pure core: check ONE intent against new items via the injected model. */
export async function checkIntent(
  llm: Llm,
  intent: Intent,
  items: string[],
  meta: { source: string; scope: string },
): Promise<DivergenceRecord> {
  const base = {
    id: nextId(),
    intentRef: intent.id,
    intentStatement: intent.statement,
    source: meta.source,
    scope: meta.scope,
    at: new Date().toISOString(),
  };
  try {
    const raw = await llm('Reply ONLY with the JSON object.', comparePrompt(intent, items), DIVERGE_SCHEMA);
    const v = parseDivergence(raw, items.length);
    if (!v) return { ...base, status: 'insufficient_signal', evidence: [], rationale: 'invalid model verdict — silent by default' };
    return { ...base, status: v.status, evidence: v.evidence.map((n) => items[n - 1]!), rationale: v.rationale };
  } catch {
    return { ...base, status: 'insufficient_signal', evidence: [], rationale: 'model unavailable — silent by default' };
  }
}

const store = (): JsonFileCollection<DivergenceRecord> =>
  new JsonFileCollection<DivergenceRecord>(path.join(config.comb.dataDir, 'divergences.json'));

export async function listDivergences(limit = 20): Promise<DivergenceRecord[]> {
  return (await store().read()).slice(-limit).reverse();
}

const ollamaLlm: Llm = async (system, prompt, schema) => {
  const json = await postJson<{ message?: { content?: string } }>(
    `${config.ollama.baseUrl}/api/chat`,
    {
      model: config.ollama.generationModel,
      stream: false,
      keep_alive: config.ollama.keepAlive,
      options: { temperature: 0 },
      format: schema,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    },
    { label: 'Divergence check' },
  );
  return json.message?.content ?? '';
};

/**
 * The watcher — called on every ingest. Checks the new content against every
 * enabled Intent visible in the ingest scope; persists ALL verdicts (the
 * aligned/insufficient majority stays silent but auditable); a DIVERGED flag
 * becomes an approvable action in the existing queue (ADJUST), attributed to
 * the engine. Best-effort: observability must never fail the ingest.
 */
export async function runDivergenceWatch(
  brain: Brain,
  event: { content: string; source: string; scope: string },
  llm?: Llm,
): Promise<DivergenceRecord[]> {
  try {
    const intents = (await getIntentStore().list([event.scope])).filter((i) => i.enabled);
    if (!intents.length) return [];
    const model = llm ?? (config.backend === 'local' ? ollamaLlm : null);
    if (!model) return []; // no capable model configured → silent, never guess
    const items = [event.content.slice(0, 2000)];
    const records: DivergenceRecord[] = [];
    for (const intent of intents) {
      const rec = await checkIntent(model, intent, items, { source: event.source, scope: event.scope });
      if (rec.status === 'diverged') {
        try {
          const r = await ActionService.create(brain).propose(
            {
              title: `Divergence: ${intent.statement.slice(0, 60)}`,
              instruction: `Draft a short, factual divergence alert. Reality just observed: "${rec.evidence[0]?.slice(0, 300)}". The intent it endangers: "${intent.statement}". State what diverged and what decision is needed.`,
              query: intent.statement,
              by: 'divergence-engine',
            },
            [event.scope],
          );
          if (r.ok) rec.actionId = r.action.id;
        } catch {
          // flag stands even if the action draft failed
        }
      }
      records.push(rec);
      await store().append(rec);
    }
    return records;
  } catch {
    return []; // never fail the ingest it observes
  }
}
