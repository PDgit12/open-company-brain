import { describe, it, expect } from 'vitest';
import { buildDocuments } from '../src/brain/ingest.js';

/**
 * Scope-isolation regression: the SAME text in two access scopes must produce
 * two distinct records, not collapse to one. The id was `source:hash(text)` —
 * scope-blind — so re-ingesting identical text under a new scope silently moved
 * the record across the scope boundary (upsert is keyed by id). Access is now
 * part of the id.
 */
describe('record id is scope-aware', () => {
  it('same text + source in different scopes → different ids', () => {
    const a = buildDocuments({ format: 'text', content: 'shared fact', source: 's', access: 'team-a' });
    const b = buildDocuments({ format: 'text', content: 'shared fact', source: 's', access: 'team-b' });
    expect(a[0]!.id).not.toBe(b[0]!.id);
    expect(a[0]!.id).toContain('team-a');
    expect(b[0]!.id).toContain('team-b');
  });
});
