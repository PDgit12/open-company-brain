/**
 * URL connector — a data source that is a LINK.
 *
 * Fetches a web page and reduces it to readable text so it can flow through the
 * same refinery → embed → store pipeline as any file. Deliberately dependency-
 * free: strip scripts/styles/tags, decode common entities, collapse whitespace.
 * Good enough for docs/wikis/policy pages; not a full browser (no JS rendering).
 *
 * The source label defaults to the host+path so citations point back to origin.
 */

export interface FetchedPage {
  text: string;
  source: string;
}

/** Strip a fetched HTML document to plain readable text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A sane default source label from a URL: host + first path segment. */
export function sourceFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg ? `${u.host}/${seg}` : u.host;
  } catch {
    return 'web';
  }
}

export function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/** Fetch a URL and return readable text + a source label. JSON passes through. */
export async function fetchUrl(url: string, timeoutMs = 20000): Promise<FetchedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'comb/0.5 (+knowledge-ingest)' } });
    if (!res.ok) throw new Error(`fetch failed (${res.status}) for ${url}`);
    const ctype = res.headers.get('content-type') ?? '';
    const raw = await res.text();
    const text = ctype.includes('html') ? htmlToText(raw) : raw.trim();
    if (!text) throw new Error(`no readable text extracted from ${url}`);
    return { text, source: sourceFromUrl(url) };
  } finally {
    clearTimeout(timer);
  }
}
