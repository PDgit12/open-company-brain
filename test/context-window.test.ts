import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  knownWindow,
  ollamaWindow,
  resolveContextWindow,
  FALLBACK_WINDOW,
} from '../src/harness/context-window.js';

afterEach(() => vi.restoreAllMocks());

describe('knownWindow — longest-prefix model table', () => {
  it('matches known prefixes case-insensitively', () => {
    expect(knownWindow('llama3.2:1b')).toBe(131072);
    expect(knownWindow('Qwen2.5:14b')).toBe(32768);
    expect(knownWindow('gpt-4o-mini')).toBe(128000);
    expect(knownWindow('claude-sonnet-4-6')).toBe(200000);
  });

  it('prefers the longest prefix (llama3.2 over llama3)', () => {
    expect(knownWindow('llama3:8b')).toBe(8192);
    expect(knownWindow('llama3.2:3b')).toBe(131072);
  });

  it('returns 0 for unknown models', () => {
    expect(knownWindow('totally-novel-model')).toBe(0);
  });
});

describe('ollamaWindow — server introspection', () => {
  it('reads the architecture-prefixed context_length', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ model_info: { 'llama.context_length': 131072, 'llama.other': 1 } }),
    }));
    expect(await ollamaWindow('http://x', 'llama3.2:1b')).toBe(131072);
  });

  it('returns 0 when the server is unreachable (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await ollamaWindow('http://x', 'llama3.2:1b')).toBe(0);
  });
});

describe('resolveContextWindow — dynamic resolution on the mock backend', () => {
  it('falls back to table/default (mock model is unknown) and derives memory budget', async () => {
    const r = await resolveContextWindow();
    // mock backend: no pin (default 0), model "mock" not in table → default.
    expect(r.tokens).toBe(FALLBACK_WINDOW);
    expect(r.source).toBe('default');
    expect(r.memoryTokens).toBe(Math.floor(FALLBACK_WINDOW * 0.35));
  });
});
