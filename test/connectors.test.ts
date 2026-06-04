import { describe, it, expect } from 'vitest';
import { parseCsv } from '../src/connectors/csv.js';

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

  it('handles arbitrary columns (schema-agnostic)', () => {
    const rows = parseCsv('ticket,priority,owner\nT-1,high,dana');
    expect(rows).toEqual([{ ticket: 'T-1', priority: 'high', owner: 'dana' }]);
  });
});
