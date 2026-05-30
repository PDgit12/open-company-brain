import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCsv, CsvConnector } from '../src/connectors/csv.js';
import { snapshotToDocuments } from '../src/brain/documents.js';

const SAMPLE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../examples/sample-data',
);

describe('CSV parser', () => {
  it('parses headers, quoted fields and escaped quotes', () => {
    const rows = parseCsv('id,note\n1,"a, b"\n2,"he said ""hi"""\n');
    expect(rows).toEqual([
      { id: '1', note: 'a, b' },
      { id: '2', note: 'he said "hi"' },
    ]);
  });

  it('ignores blank trailing lines', () => {
    expect(parseCsv('id\n1\n\n')).toEqual([{ id: '1' }]);
  });
});

describe('CSV connector (real files, no keys)', () => {
  it('ingests the sample folder into a usable snapshot', async () => {
    const snap = await new CsvConnector(SAMPLE).loadSnapshot();
    expect(snap.companies.length).toBe(3);
    expect(snap.contacts.length).toBe(3);
    expect(snap.engagements.length).toBe(3);
    expect(snap.companies.map((c) => c.name)).toContain('Orbital Robotics');
  });

  it('the ingested snapshot turns into memory documents end-to-end', async () => {
    const snap = await new CsvConnector(SAMPLE).loadSnapshot();
    const docs = snapshotToDocuments(snap);
    // one doc per company + contact + engagement
    expect(docs.length).toBe(9);
    expect(docs.some((d) => d.text.includes('Orbital Robotics'))).toBe(true);
  });

  it('returns empty entities for a folder with no CSVs (no crash)', async () => {
    const snap = await new CsvConnector('/tmp/definitely-not-here-xyz').loadSnapshot();
    expect(snap.companies).toEqual([]);
  });
});
