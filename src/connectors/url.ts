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

/** Private/loopback/link-local ranges an SSRF must never reach (incl. cloud metadata). */
function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 127 || a === 10 || // unspecified · loopback · private
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 169 && b === 254) // link-local incl. 169.254.169.254 (metadata)
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

/**
 * SSRF guard. Reject non-http(s), and — after resolving DNS — any host that
 * maps to a private/loopback/link-local/metadata address. Resolving first
 * defeats hostnames that point at internal IPs and basic DNS-rebinding.
 */
export async function assertPublicUrl(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Refusing non-http(s) URL: ${u.protocol}`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || isPrivateIp(host)) {
    throw new Error(`Refusing to fetch a private/internal address: ${host}`);
  }
  const { lookup } = await import('node:dns/promises');
  const resolved = await lookup(host, { all: true }).catch(() => []);
  for (const r of resolved) {
    if (isPrivateIp(r.address)) {
      throw new Error(`Refusing ${host} — resolves to a private/internal address (${r.address}).`);
    }
  }
}

/** Fetch a URL and return readable text + a source label. JSON passes through. */
export async function fetchUrl(url: string, timeoutMs = 20000): Promise<FetchedPage> {
  await assertPublicUrl(url); // SSRF guard — before any network call
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'error', headers: { 'user-agent': 'comb/0.6 (+knowledge-ingest)' } });
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
