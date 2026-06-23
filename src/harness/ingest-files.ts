/**
 * File-collection helpers for `comb ingest <file|folder>`. Extracted from the CLI
 * (which self-executes `main()` on import, so it can't be imported by a test) into
 * a pure module that IS unit-tested — folder ingest is a path users hit first, and
 * "it silently ingested nothing / the wrong files" is exactly the kind of break
 * that should fail a test, not a demo.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/** Extensions Comb knows how to ingest. Binary docs (docx/pdf) are extracted to text. */
export const INGEST_EXTS = new Set(['txt', 'md', 'csv', 'json', 'docx', 'pdf']);

const extOf = (f: string): string => (f.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();

/** Map a filename to the ingest format (defaults to text). */
export const formatFor = (f: string): 'text' | 'csv' | 'json' => {
  const ext = extOf(f);
  return ext === 'csv' ? 'csv' : ext === 'json' ? 'json' : 'text';
};

/**
 * Fold an OKF (Google Open Knowledge Format, 2026) concept's YAML frontmatter
 * into the body so its metadata (type, title, tags, description) is searchable —
 * instead of ingesting raw `---` YAML as opaque text. OKF v0.1 frontmatter is
 * flat (type required; title/description/resource/tags/timestamp optional), so a
 * tiny parser is enough — no YAML dependency for a handful of `key: value` lines.
 * A file with no frontmatter passes through unchanged.
 */
export function foldFrontmatter(raw: string): string {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return raw;
  const fm = m[1] ?? '';
  const body = m[2] ?? '';
  const fields: Record<string, string> = {};
  for (const line of fm.split('\n')) {
    const f = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (f?.[1]) fields[f[1].toLowerCase()] = (f[2] ?? '').replace(/^\[|\]$/g, '').replace(/^["']|["']$/g, '').trim();
  }
  const head = [
    fields.title && `# ${fields.title}`,
    fields.type && `type: ${fields.type}`,
    fields.tags && `tags: ${fields.tags}`,
    fields.description,
  ].filter(Boolean).join('\n');
  return `${head}\n\n${body}`.trim();
}

/**
 * Read a file's content as ingestable text + its format. Real company docs are
 * docx/pdf, not just .md — so binary office formats are extracted to plain text
 * (parsers loaded lazily, only when that extension is actually hit). Markdown is
 * OKF-folded (frontmatter → searchable text). Everything else is read as UTF-8
 * and keeps its csv/json/text format.
 */
export async function extractText(file: string): Promise<{ content: string; format: 'text' | 'csv' | 'json' }> {
  const ext = extOf(file);
  if (ext === 'docx') {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ path: file });
    return { content: value, format: 'text' };
  }
  if (ext === 'pdf') {
    const { PDFParse } = await import('pdf-parse');
    const { text } = await new PDFParse({ data: await readFile(file) }).getText();
    return { content: text, format: 'text' };
  }
  const raw = await readFile(file, 'utf8');
  // OKF concepts are markdown with YAML frontmatter — fold it so the metadata is
  // searchable. Only .md/.txt (text format); csv/json pass through untouched.
  if (ext === 'md' || ext === 'txt') return { content: foldFrontmatter(raw), format: 'text' };
  return { content: raw, format: formatFor(file) };
}

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
