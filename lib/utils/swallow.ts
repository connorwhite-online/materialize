/**
 * Per-query catch wrapper for non-fatal listing-detail data.
 *
 * Neon's HTTP edge can intermittently throw `TypeError: fetch failed`
 * connect timeouts during cold starts. When several auxiliary queries
 * run inside a `Promise.all` on a server-component page, one transient
 * failure rejects the whole `Promise.all` and 500s the page even
 * though the page's primary data already loaded.
 *
 * Wrap each *non-critical* query in `swallow(...)` to fall back to an
 * empty array on failure. The rest of the page renders; only the
 * affected section is empty. The error still hits stderr so the flake
 * is visible during dev. Use only for query results you're willing to
 * render as "empty" — never for primary page data.
 */
export function swallow<T>(p: Promise<T[]>, label = "swallowed query"): Promise<T[]> {
  return p.catch((err) => {
    console.warn(`[${label}] non-fatal:`, err);
    return [] as T[];
  });
}
