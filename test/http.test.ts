import { describe, it, expect, vi, afterEach } from 'vitest';
import { postJson } from '../src/harness/http.js';

const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const errResponse = (status: number, text = '') => ({ ok: false, status, text: async () => text });

afterEach(() => vi.restoreAllMocks());

describe('postJson — resilient model-call POST', () => {
  it('returns parsed JSON on success (single call)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ hello: 'world' }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await postJson<{ hello: string }>('http://x/api', { a: 1 }, { retries: 0 });
    expect(out).toEqual({ hello: 'world' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retries a 5xx then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(503, 'busy'))
      .mockResolvedValueOnce(okResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await postJson<{ ok: boolean }>('http://x/api', {}, { retries: 2, label: 'Test' });
    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a 4xx (caller error)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResponse(400, 'bad'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(postJson('http://x/api', {}, { retries: 3, label: 'Test' })).rejects.toThrow(/Test failed \(400\)/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retries a transient network error then throws when the budget is exhausted', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(postJson('http://x/api', {}, { retries: 1 })).rejects.toThrow(/ECONNREFUSED/);
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial + 1 retry
  });
});
