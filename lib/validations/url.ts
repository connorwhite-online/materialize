/**
 * SEC-B1 — shared scheme allowlist for user-submitted URLs that later
 * render raw into an `href=` attribute on a public page.
 *
 * Bare `z.string().url()` accepts ANY scheme WHATWG's URL parser
 * recognizes, including `javascript:`. A `javascript:alert(1)` value
 * saved through socialLinkSchema.url or repoUrl and rendered as
 * `<a href={value}>` (components/profile/user-profile-view.tsx,
 * components/projects/source-code-card.tsx) is a stored-XSS
 * primitive — the browser executes it on click, no injection into
 * markup required.
 *
 * lib/validations/bom.ts's `bomItemSchema.sourceUrl` already guards
 * this by requiring `https://` specifically; this helper is the
 * same idea but allows plain `http://` too, since social links and
 * repo URLs (unlike BOM vendor links) commonly point at http-only
 * legacy sites.
 */
export function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

export const HTTP_URL_SCHEME_MESSAGE = "Must use http:// or https://";
