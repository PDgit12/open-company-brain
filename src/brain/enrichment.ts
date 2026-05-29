/**
 * Relation-enrichment — derive theme tags from record text.
 *
 * Themes make thematic retrieval sharper ("which partners care about X?") and
 * give the UI useful labels. This is the DETERMINISTIC, controllable version:
 * keyword → theme, so a tag is never an opaque AI guess and is easy to test.
 *
 * UPGRADE PATH (live): swap `deriveThemes` for an LLM call (via the Generator)
 * that proposes tags from a fixed vocabulary. Keep the vocabulary closed so the
 * output stays inspectable — the whole point of enrichment-with-guardrails.
 */

const THEME_RULES: ReadonlyArray<{ pattern: RegExp; theme: string }> = [
  { pattern: /\b(ml|machine learning|ai)\b/i, theme: 'ml-research' },
  { pattern: /\bresearch\b/i, theme: 'research' },
  { pattern: /\bsponsor/i, theme: 'sponsorship' },
  { pattern: /\b(recruit|talent|hiring|placement)\b/i, theme: 'recruiting' },
  { pattern: /\b(event|competition|symposium)\b/i, theme: 'events' },
  { pattern: /\b(project|projects)\b/i, theme: 'projects' },
  { pattern: /\b(energy|battery|materials)\b/i, theme: 'r-and-d' },
  { pattern: /\b(fintech|finance|capital)\b/i, theme: 'fintech' },
];

/** Derive a sorted, de-duplicated set of themes from one or more text blobs. */
export function deriveThemes(...texts: Array<string | null | undefined>): string[] {
  const haystack = texts.filter(Boolean).join(' \n ');
  const found = new Set<string>();
  for (const { pattern, theme } of THEME_RULES) {
    if (pattern.test(haystack)) found.add(theme);
  }
  return [...found].sort();
}
