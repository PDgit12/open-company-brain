import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectFiles, formatFor, baseName, INGEST_EXTS } from '../src/harness/ingest-files.js';

describe('folder ingest — file collection (the EISDIR-regression guard)', () => {
  it('formatFor maps extensions, defaulting to text', () => {
    expect(formatFor('a.csv')).toBe('csv');
    expect(formatFor('a.json')).toBe('json');
    expect(formatFor('a.md')).toBe('text');
    expect(formatFor('a.txt')).toBe('text');
    expect(formatFor('README')).toBe('text');
  });

  it('baseName strips directory and extension', () => {
    expect(baseName('/a/b/refund-policy.md')).toBe('refund-policy');
    expect(baseName('notes.txt')).toBe('notes');
  });

  it('collectFiles finds supported files recursively, skips the rest, sorted', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'comb-collect-'));
    await writeFile(path.join(dir, 'b.md'), '#');
    await writeFile(path.join(dir, 'a.txt'), 'x');
    await writeFile(path.join(dir, 'data.csv'), 'x');
    await writeFile(path.join(dir, 'ignore.png'), 'x'); // unsupported
    await writeFile(path.join(dir, 'notes.json'), '{}');
    await mkdir(path.join(dir, 'sub'));
    await writeFile(path.join(dir, 'sub', 'deep.md'), '#'); // recursive

    const files = (await collectFiles(dir)).map((f) => f.replace(dir + '/', ''));
    expect(files).toEqual(['a.txt', 'b.md', 'data.csv', 'notes.json', 'sub/deep.md']);
    expect(files).not.toContain('ignore.png');
  });

  it('collectFiles returns [] for a folder with no ingestable files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'comb-empty-'));
    await writeFile(path.join(dir, 'logo.png'), 'x');
    expect(await collectFiles(dir)).toEqual([]);
  });

  it('the supported set is exactly the documented formats', () => {
    expect([...INGEST_EXTS].sort()).toEqual(['csv', 'json', 'md', 'txt']);
  });
});
