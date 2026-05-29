/**
 * Prompt construction — pure functions, no I/O.
 *
 * The trust contract lives here: the system prompt forbids ungrounded claims and
 * requires citations. We also assemble the context block from retrieved chunks
 * so the same grounding logic is testable in isolation.
 */

import type { RetrievedChunk } from '../brain/memory.js';
import type { Path } from '../graph/relationships.js';

export const SYSTEM_PROMPT = `You are an organization's knowledge brain.
You help people prepare for conversations and answer questions using ONLY the context provided.

Hard rules:
- Use only facts present in the CONTEXT block. Never invent names, dates, or figures.
- Cite the source of each fact inline like [companies] or [engagements].
- If the context does not contain the answer, say plainly: "I don't have that in the brain yet." Do not guess.
- Be concise and scannable. Lead with what the reader most needs to know.`;

/** Build the grounded context block fed to the model. */
export function buildContextBlock(chunks: RetrievedChunk[], introPath?: Path | null): string {
  const parts: string[] = [];

  if (chunks.length === 0) {
    parts.push('(no matching records found in the brain)');
  } else {
    chunks.forEach((c, i) => {
      parts.push(`[#${i + 1} source=${c.source}]\n${c.text}`);
    });
  }

  if (introPath) {
    parts.push(`[relationship-path]\nConnection path: ${introPath.description}`);
  }

  return parts.join('\n\n---\n\n');
}

export function buildBriefingPrompt(companyName: string, context: string): string {
  return `Prepare a briefing for an upcoming conversation with: ${companyName}

Produce:
1. Snapshot — tier, industry, one-line relationship status.
2. Recent activity — most recent engagements.
3. Open items — anything outstanding.
4. Suggested talking points — grounded in the history only.

CONTEXT:
${context}`;
}

export function buildAskPrompt(question: string, context: string): string {
  return `Question from a user: ${question}

Answer using only the context. Cite sources.

CONTEXT:
${context}`;
}
