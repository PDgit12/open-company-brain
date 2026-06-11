/**
 * Dynamic context window — resolve the active model's REAL window, never guess.
 *
 * Why it matters: every packing decision (how much conversation memory to
 * replay, how much retrieved grounding to include) divides this one number. Pin
 * it too small and a 128k model runs with amnesia (context thrown away for no
 * reason); too big and a 4k model gets an over-stuffed prompt that the server
 * silently truncates — usually clipping the system prompt or the user's actual
 * question, the worst possible failure because nothing errors.
 *
 * Resolution order (first hit wins):
 *   1. COMB_CONTEXT_WINDOW_TOKENS > 0 — explicit pin, the operator knows best.
 *   2. Local backend: ask Ollama (`/api/show` → model_info *.context_length`) —
 *      the server KNOWS its model; no table can be more correct.
 *   3. A known-models prefix table (OpenAI-compatible providers have no
 *      standard introspection endpoint).
 *   4. A conservative 8192 default — small enough to be safe on any model.
 */

import { config } from '../config.js';
import { postJson } from './http.js';

/** Known context windows by model-name prefix (longest prefix wins). */
export const KNOWN_WINDOWS: Record<string, number> = {
  'llama3.2': 131072,
  'llama3.1': 131072,
  'llama3': 8192,
  'qwen2.5': 32768,
  'qwen3': 40960,
  'mistral': 32768,
  'mixtral': 32768,
  'phi3': 131072,
  'gemma2': 8192,
  'gemma3': 131072,
  'deepseek-r1': 131072,
  'gpt-4o': 128000,
  'gpt-4.1': 1047576,
  'gpt-4-turbo': 128000,
  'gpt-3.5-turbo': 16385,
  'o3': 200000,
  'o4-mini': 200000,
  'claude-': 200000,
};

export const FALLBACK_WINDOW = 8192;

/** Longest-prefix lookup in the known-models table. 0 = unknown. */
export function knownWindow(model: string): number {
  const m = model.toLowerCase();
  let best = '';
  for (const prefix of Object.keys(KNOWN_WINDOWS)) {
    if (m.startsWith(prefix) && prefix.length > best.length) best = prefix;
  }
  return best ? KNOWN_WINDOWS[best]! : 0;
}

/** Ask Ollama what the loaded model's context length actually is. 0 = unknown. */
export async function ollamaWindow(baseUrl: string, model: string): Promise<number> {
  try {
    const json = await postJson<{ model_info?: Record<string, unknown> }>(
      `${baseUrl}/api/show`,
      { model },
      { label: 'Ollama show', retries: 0, timeoutMs: 5000 },
    );
    const info = json.model_info ?? {};
    // The key is architecture-prefixed, e.g. "llama.context_length".
    for (const [k, v] of Object.entries(info)) {
      if (k.endsWith('.context_length') && typeof v === 'number' && v > 0) return v;
    }
  } catch {
    // Ollama down or model missing — fall through to the table.
  }
  return 0;
}

/** The generation model the active backend will use. */
export function activeGenerationModel(): string {
  if (config.backend === 'local') return config.ollama.generationModel;
  if (config.backend === 'openai') return config.openai.model;
  if (config.backend === 'langbase') return config.langbase.generationModel.replace(/^[^:]+:/, '');
  return 'mock';
}

export interface ResolvedWindow {
  tokens: number;
  /** Where the number came from — surfaced in the banner. */
  source: 'pinned' | 'ollama' | 'table' | 'default';
  /** Tokens conversation memory may occupy (window × fraction). */
  memoryTokens: number;
}

export async function resolveContextWindow(): Promise<ResolvedWindow> {
  const finish = (tokens: number, source: ResolvedWindow['source']): ResolvedWindow => ({
    tokens,
    source,
    memoryTokens: Math.floor(tokens * config.comb.memoryWindowFraction),
  });

  if (config.comb.contextWindowTokens > 0) return finish(config.comb.contextWindowTokens, 'pinned');
  if (config.backend === 'local') {
    const fromOllama = await ollamaWindow(config.ollama.baseUrl, config.ollama.generationModel);
    if (fromOllama > 0) return finish(fromOllama, 'ollama');
  }
  const fromTable = knownWindow(activeGenerationModel());
  if (fromTable > 0) return finish(fromTable, 'table');
  return finish(FALLBACK_WINDOW, 'default');
}
