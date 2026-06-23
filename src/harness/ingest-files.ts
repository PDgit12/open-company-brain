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

/** OKF metadata mapped from a concept's frontmatter (for faithful round-trip). */
export interface OkfMeta {
  kind?: string;
  themes?: string;
  title?: string;
}

/**
 * Parse an OKF (Google Open Knowledge Format, 2026) concept's YAML frontmatter.
 * OKF v0.1 frontmatter is flat (type required; title/description/resource/tags/
 * timestamp optional), so a tiny parser is enough — no YAML dependency for a
 * handful of `key: value` lines. No frontmatter → empty fields, body = raw.
 */
export function parseFrontmatter(raw: string): { fields: Record<string, string>; body: string } {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { fields: {}, body: raw };
  const fields: Record<string, string> = {};
  for (const line of (m[1] ?? '').split('\n')) {
    const f = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (f?.[1]) fields[f[1].toLowerCase()] = (f[2] ?? '').replace(/^\[|\]$/g, '').replace(/^["']|["']$/g, '').trim();
  }
  return { fields, body: m[2] ?? '' };
}

/** Searchable header so OKF metadata is retrievable even on the keyword path. */
function foldHead(fields: Record<string, string>): string {
  return [
    fields.title && `# ${fields.title}`,
    fields.type && `type: ${fields.type}`,
    fields.tags && `tags: ${fields.tags}`,
    fields.description,
  ].filter(Boolean).join('\n');
}

/** Fold a concept's frontmatter into the body so its fields are searchable. */
export function foldFrontmatter(raw: string): string {
  const { fields, body } = parseFrontmatter(raw);
  if (!Object.keys(fields).length) return raw;
  return `${foldHead(fields)}\n\n${body}`.trim();
}

/**
 * Read a file's content as ingestable text + its format + any OKF metadata.
 * Real company docs are docx/pdf, not just .md — binary office formats are
 * extracted to plain text (parsers loaded lazily). Markdown is OKF-folded so
 * its frontmatter is both searchable (in the body) AND structured (in `meta`,
 * so `comb export` round-trips type/tags). csv/json pass through untouched.
 */
export async function extractText(file: string): Promise<{ content: string; format: 'text' | 'csv' | 'json'; meta?: OkfMeta }> {
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
  if (ext === 'md' || ext === 'txt') {
    const { fields, body } = parseFrontmatter(raw);
    if (!Object.keys(fields).length) return { content: raw, format: 'text' };
    const meta: OkfMeta = {};
    if (fields.type) meta.kind = fields.type;
    if (fields.tags) meta.themes = fields.tags;
    if (fields.title) meta.title = fields.title;
    return { content: `${foldHead(fields)}\n\n${body}`.trim(), format: 'text', meta };
  }
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
