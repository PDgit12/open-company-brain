/**
 * Export the brain as a Google Open Knowledge Format (OKF, 2026) bundle: a
 * directory of markdown concept files with YAML frontmatter. Pure (testable;
 * the CLI self-executes on import, so the file-writing wrapper lives in cli.ts).
 *
 * A record's `kind` becomes OKF `type`, `themes` become `tags`, and same-source
 * records group into one concept file. NOT a byte-identical round-trip: ingest
 * folds an OKF concept's frontmatter into searchable body text (it isn't stored
 * as structured `kind`/`themes`), so an ingest→export cycle re-wraps with default
 * metadata. The export is still valid, scope-gated OKF.
 */

import type { MemoryDocument } from '../brain/documents.js';
import { META_ACCESS, META_SOURCE, META_KIND, META_THEMES } from '../constants.js';

export interface OkfFile {
  filename: string;
  content: string;
}

const slug = (s: string): string =>
  s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'concept';

/** Group scoped brain records by source into OKF concept files. */
export function toOkfBundle(docs: MemoryDocument[], scopes: string[]): OkfFile[] {
  const allowed = new Set(scopes);
  const bySource = new Map<string, MemoryDocument[]>();
  for (const d of docs) {
    if (!allowed.has(d.metadata[META_ACCESS] ?? '')) continue; // scope-gated, like every read
    const src = d.metadata[META_SOURCE] ?? 'unknown';
    const group = bySource.get(src) ?? [];
    group.push(d);
    bySource.set(src, group);
  }
  const files: OkfFile[] = [];
  for (const [source, group] of bySource) {
    const type = group[0]?.metadata[META_KIND] || 'concept';
    const tags = group[0]?.metadata[META_THEMES];
    const frontmatter = ['---', `type: ${type}`, `title: ${source}`, tags ? `tags: ${tags}` : '', '---']
      .filter(Boolean)
      .join('\n');
    const body = group.map((d) => d.text).join('\n\n');
    files.push({ filename: `${slug(source)}.md`, content: `${frontmatter}\n${body}\n` });
  }
  return files;
}
