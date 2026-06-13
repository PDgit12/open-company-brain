import { describe, it, expect } from 'vitest';
import { assertPublicUrl } from '../src/connectors/url.js';

describe('URL connector — SSRF guard', () => {
  it('rejects cloud metadata, loopback, and private ranges', async () => {
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/private|internal/i);
    await expect(assertPublicUrl('http://localhost:6379/')).rejects.toThrow(/private|internal/i);
    await expect(assertPublicUrl('http://127.0.0.1/')).rejects.toThrow(/private|internal/i);
    await expect(assertPublicUrl('http://10.0.0.5/')).rejects.toThrow(/private|internal/i);
    await expect(assertPublicUrl('http://192.168.1.1/')).rejects.toThrow(/private|internal/i);
  });
  it('rejects non-http(s) protocols (file://, gopher://, etc.)', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/non-http/i);
    await expect(assertPublicUrl('gopher://x/')).rejects.toThrow(/non-http/i);
  });
  it('allows a normal public URL', async () => {
    await expect(assertPublicUrl('https://example.com/page')).resolves.toBeUndefined();
  });
});
