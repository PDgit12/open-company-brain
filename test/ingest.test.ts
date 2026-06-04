import { describe, it, expect } from 'vitest';
import { buildDocuments, normalizeSource, MAX_INGEST_CHARS } from '../src/brain/ingest.js';
import { META_ACCESS, META_SOURCE, META_KIND } from '../src/constants.js';

/**
 * Ingestion turns pasted text/CSV/JSON into scoped, embeddable memory docs.
 * These pin the contract the dashboard "Connect data" flow relies on: arbitrary
 * shapes become readable docs, access is always the caller-validated scope, and
 * re-ingesting identical content is idempotent (stable ids).
 */
describe('buildDocuments — text', () => {
  it('splits on blank lines into one doc per chunk, pinned to the access scope', () => {
    const docs = buildDocuments({
      format: 'text',
      content: 'First note about Acme renewal.\n\nSecond unrelated note.',
      source: 'Meeting Notes',
      access: 'sales-team',
    });
    expect(docs).toHaveLength(2);
    expect(docs[0]!.metadata[META_ACCESS]).toBe('sales-team');
    expect(docs[0]!.metadata[META_KIND]).toBe('note');
    expect(docs[0]!.metadata[META_SOURCE]).toBe('meeting-notes'); // normalized
    expect(docs[0]!.text).toContain('Acme renewal');
  });

  it('is idempotent — identical content yields identical ids', () => {
    const input = { format: 'text' as const, content: 'stable note', source: 'notes', access: 'default-team' };
    expect(buildDocuments(input)[0]!.id).toBe(buildDocuments(input)[0]!.id);
  });
});

describe('buildDocuments — csv', () => {
  it('renders arbitrary columns as Key: value lines (not just the CRM schema)', () => {
    const docs = buildDocuments({
      format: 'csv',
      content: 'ticket,priority,owner\nTASK-1,high,dana\nTASK-2,low,marcus',
      source: 'jira',
      access: 'default-team',
    });
    expect(docs).toHaveLength(2);
    expect(docs[0]!.text).toContain('ticket: TASK-1');
    expect(docs[0]!.text).toContain('priority: high');
    expect(docs[0]!.metadata[META_SOURCE]).toBe('jira');
  });

  it('uses an explicit id column for a stable record id when present', () => {
    const docs = buildDocuments({
      format: 'csv',
      content: 'id,note\n42,hello',
      source: 'x',
      access: 'default-team',
    });
    expect(docs[0]!.id).toBe('x:42');
  });
});

describe('buildDocuments — json', () => {
  it('treats an array of objects as one doc each', () => {
    const docs = buildDocuments({
      format: 'json',
      content: JSON.stringify([{ name: 'A', status: 'open' }, { name: 'B', status: 'done' }]),
      source: 'tasks',
      access: 'default-team',
    });
    expect(docs).toHaveLength(2);
    expect(docs[1]!.text).toContain('name: B');
  });

  it('always pins the caller-validated access scope onto every emitted doc', () => {
    const docs = buildDocuments({
      format: 'json',
      content: JSON.stringify([{ name: 'ScopeTest Co', status: 'active' }]),
      source: 'import',
      access: 'default-team',
    });
    expect(docs).toHaveLength(1);
    // SECURITY: the access scope is forced by the caller, never the payload.
    expect(docs[0]!.metadata[META_ACCESS]).toBe('default-team');
    expect(docs[0]!.text).toContain('ScopeTest Co');
  });
});

describe('buildDocuments — guards', () => {
  it('rejects an over-size payload', () => {
    const huge = 'x'.repeat(MAX_INGEST_CHARS + 1);
    expect(() => buildDocuments({ format: 'text', content: huge, source: 'n', access: 'd' })).toThrow(/too large/i);
  });

  it('normalizeSource falls back to "notes" for empty/garbage labels', () => {
    expect(normalizeSource('   ')).toBe('notes');
    expect(normalizeSource('My Cool Source!!')).toBe('my-cool-source');
  });
});
