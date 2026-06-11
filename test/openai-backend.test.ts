import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIGenerator } from '../src/agents/generator.js';
import { OpenAIEmbedder } from '../src/brain/embedding.js';

afterEach(() => vi.restoreAllMocks());

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe('OpenAIGenerator — BYO-key chat completions', () => {
  it('sends the bearer key and parses choices[0].message.content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ choices: [{ message: { content: 'hi there' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await new OpenAIGenerator('https://api.example.test/v1', 'sk-test', 'gpt-4o-mini')
      .generate({ prompt: 'q', chunks: [] });
    expect(out).toBe('hi there');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string).model).toBe('gpt-4o-mini');
  });
});

describe('OpenAIEmbedder — BYO-key embeddings', () => {
  it('batches one request and restores order by index', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({
      data: [
        { index: 1, embedding: [2, 2] },
        { index: 0, embedding: [1, 1] },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const e = new OpenAIEmbedder('https://api.example.test/v1', 'sk-test', 'text-embedding-3-small', 2);
    const out = await e.embed(['a', 'b']);
    expect(out).toEqual([[1, 1], [2, 2]]); // index-sorted, not arrival order
    expect(fetchMock).toHaveBeenCalledOnce(); // batched
    expect(await e.embed([])).toEqual([]); // no call for empty input
  });

  it('fails loudly on a count mismatch instead of misaligning vectors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ data: [{ index: 0, embedding: [1] }] })));
    const e = new OpenAIEmbedder('https://x/v1', 'k', 'm', 1);
    await expect(e.embed(['a', 'b'])).rejects.toThrow(/1 vectors for 2 inputs/);
  });
});
