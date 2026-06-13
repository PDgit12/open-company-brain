import { describe, it, expect } from 'vitest';
import { htmlToText, sourceFromUrl, isUrl } from '../src/connectors/url.js';

describe('URL connector — link as a data source', () => {
  it('strips scripts/styles/tags and decodes entities to readable text', () => {
    const html = `<html><head><style>x{}</style></head><body>
      <h1>Refund Policy</h1><script>evil()</script>
      <p>Refunds over $10,000 need Finance &amp; VP approval.</p>
      <p>Returns within 30&nbsp;days.</p></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain('Refund Policy');
    expect(text).toContain('Finance & VP approval');
    expect(text).toContain('30 days');
    expect(text).not.toMatch(/evil|<p>|<script/);
  });

  it('derives a source label from the URL (host + first segment)', () => {
    expect(sourceFromUrl('https://wiki.acme.com/policies/refunds')).toBe('wiki.acme.com/policies');
    expect(sourceFromUrl('https://acme.com')).toBe('acme.com');
  });

  it('detects URLs vs file paths', () => {
    expect(isUrl('https://x.com')).toBe(true);
    expect(isUrl('./local.md')).toBe(false);
  });
});
