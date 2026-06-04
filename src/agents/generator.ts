/**
 * The generation layer — turns (system prompt + grounded prompt) into an answer.
 *
 *   • LangbasePipe   — runs a real Langbase Pipe (LLM) in LIVE mode.
 *   • MockGenerator  — deterministic, no LLM: it formats the retrieved context
 *     into a readable briefing/answer and honours the trust contract (it returns
 *     the "I don't have that" line when there is no context). This is what makes
 *     the showcase work with zero credentials AND makes the contract testable.
 */

import { Langbase } from 'langbase';
import { config } from '../config.js';
import { SYSTEM_PROMPT } from './prompts.js';
import type { RetrievedChunk } from '../brain/memory.js';

export const NO_CONTEXT_REPLY = "I don't have that in the brain yet.";

export interface GenerateInput {
  prompt: string;
  /** The chunks that grounded this prompt — used by the mock to format output. */
  chunks: RetrievedChunk[];
}

export interface Generator {
  generate(input: GenerateInput): Promise<string>;
}

export class MockGenerator implements Generator {
  async generate({ chunks }: GenerateInput): Promise<string> {
    // Trust contract: no grounding → refuse, exactly like the real prompt demands.
    if (chunks.length === 0) return NO_CONTEXT_REPLY;

    const header = '## Answer (grounded in the brain)\n';

    const facts = chunks
      .map((c, i) => `- ${c.text.split('\n').join(' · ')}  _[${c.source} · #${i + 1}]_`)
      .join('\n');

    return (
      `${header}\n` +
      `${facts}\n\n` +
      `_Mock generator: deterministic formatting of retrieved records. ` +
      `In LIVE mode a Langbase Pipe writes this as prose with the same sources._`
    );
  }
}

export class LangbasePipe implements Generator {
  private readonly lb: Langbase;
  private readonly pipeName: string;

  constructor(apiKey: string, pipeName: string) {
    this.lb = new Langbase({ apiKey });
    this.pipeName = pipeName;
  }

  async generate({ prompt }: GenerateInput): Promise<string> {
    const res = await this.lb.pipes.run({
      name: this.pipeName,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      stream: false,
    });
    return res.completion ?? '';
  }
}

/** Local generation via a running Ollama server (e.g. llama3.2). $0/call. */
export class OllamaGenerator implements Generator {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  async generate({ prompt }: GenerateInput): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama chat failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { message?: { content?: string } };
    return json.message?.content ?? '';
  }
}

export function createGenerator(): Generator {
  if (config.backend === 'local') {
    return new OllamaGenerator(config.ollama.baseUrl, config.ollama.generationModel);
  }
  if (config.backend === 'langbase' && config.langbase.apiKey) {
    return new LangbasePipe(config.langbase.apiKey, config.langbase.pipeName);
  }
  return new MockGenerator();
}
