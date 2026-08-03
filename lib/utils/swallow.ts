import { logError } from "@/lib/logger";

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
 * affected section is empty. Use only for query results you're
 * willing to render as "empty" — never for primary page data.
 *
 * The failure still goes to console.warn (dev visibility) AND to
 * `logError` (Sentry) so a permanently-failing query doesn't render a
 * page section empty forever with nobody noticing. Like the precedent
 * in `app/(app)/print/page.tsx`, we log a clean, application-named
 * `Error` rather than the raw driver error: the raw message (e.g.
 * "ECONNRESET"/"fetch failed") matches the connection-noise
 * `ignoreErrors` filter in sentry.server.config.ts — tuned for benign
 * client-disconnect/outbound blips — which would otherwise silently
 * swallow a failure that actually left a section blank for users. The
 * original error is preserved as `cause` and in the console.warn line.
 */
export function swallow<T>(p: Promise<T[]>, label = "swallowed query"): Promise<T[]> {
  return p.catch((err) => {
    console.warn(`[${label}] non-fatal:`, err);
    logError(
      `swallow.${label}`,
      new Error(`Swallowed query "${label}" failed; rendered empty`, {
        cause: err,
      })
    );
    return [] as T[];
  });
}
