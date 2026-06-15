/**
 * File-collection helpers for `comb ingest <file|folder>`. Extracted from the CLI
 * (which self-executes `main()` on import, so it can't be imported by a test) into
 * a pure module that IS unit-tested — folder ingest is a path users hit first, and
 * "it silently ingested nothing / the wrong files" is exactly the kind of break
 * that should fail a test, not a demo.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';

/** Extensions Comb knows how to ingest. */
export const INGEST_EXTS = new Set(['txt', 'md', 'csv', 'json']);

/** Map a filename to the ingest format (defaults to text). */
export const formatFor = (f: string): 'text' | 'csv' | 'json' => {
  const ext = (f.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
  return ext === 'csv' ? 'csv' : ext === 'json' ? 'json' : 'text';
};

/** Strip directory and extension: "/a/b/refund-policy.md" -> "refund-policy". */
export const baseName = (f: string): string => f.replace(/^.*\//, '').replace(/\.[^.]+$/, '');

/** Recursively collect ingestable files under a directory, sorted for stable order. */
export async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectFiles(full)));
    else if (INGEST_EXTS.has((entry.name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase())) out.push(full);
  }
  return out.sort();
}
