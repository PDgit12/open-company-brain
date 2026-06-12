/**
 * AnswerRecord — the typed contract between the model plane and everything else.
 *
 * v2 principle: the model never speaks prose to the SYSTEM. Inside Comb an
 * answer is a RECORD with a status enum and verified citations; prose exists
 * only at the very edge where a human reads it (renderAnswer). Downstream
 * consumers (run classifier, evals, memory hygiene, actions) read FIELDS —
 * never regex, never magic strings. A model swap changes answer quality,
 * never the contract.
 *
 * Phase 1 of the v2 migration: the record is constructed by CODE from
 * structural signals (the grounding gate, the retrieved chunks). Phase 2/3
 * move construction into constrained decoding where the model fills the
 * schema directly.
 */

import { NO_CONTEXT_REPLY } from '../agents/generator.js';
import type { RetrievedChunk } from './memory.js';

export type AnswerStatus =
  | 'answered' // grounded answer; citations are the chunks that grounded it
  | 'insufficient_context' // the gate (or selection) refused — NOT a prose choice
  | 'memory_reply'; // answered from conversation memory only (marked, uncited)

export interface AnswerRecord {
  status: AnswerStatus;
  /** Prose body for the human (refusal line for insufficient_context). */
  answer: string;
  /** The retrieved chunks that ground the answer. Empty unless 'answered'. */
  citations: RetrievedChunk[];
}

export function answered(answer: string, citations: RetrievedChunk[]): AnswerRecord {
  return { status: 'answered', answer, citations };
}

export function refusal(): AnswerRecord {
  return { status: 'insufficient_context', answer: NO_CONTEXT_REPLY, citations: [] };
}

export const MEMORY_NOTE = '(from conversation memory — no brain records matched)';

export function memoryReply(answer: string): AnswerRecord {
  return { status: 'memory_reply', answer, citations: [] };
}

/** Invariants every record must satisfy — enforced in code, not requested. */
export function isValidRecord(r: AnswerRecord): boolean {
  if (r.status === 'answered') return r.answer.trim().length > 0 && r.citations.length > 0;
  return r.citations.length === 0; // refusals/memory replies never cite
}

/**
 * THE EDGE: record → human-readable prose. The Sources footer and the memory
 * marker exist only here — nothing inside the system parses this string.
 */
export function renderAnswer(r: AnswerRecord): string {
  if (r.status === 'memory_reply') return `${r.answer.trim()}\n\n${MEMORY_NOTE}`;
  if (r.status === 'insufficient_context') return r.answer;
  const cites = [...new Set(r.citations.map((c) => c.source))];
  return cites.length ? `${r.answer}\n\nSources: ${cites.map((s) => `[${s}]`).join(' ')}` : r.answer;
}
