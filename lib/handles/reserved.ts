/**
 * Handles that are off-limits as a username OR an organization slug.
 *
 * The unified `/[handle]` namespace means any segment here would shadow
 * the corresponding route, so we block them at creation time. Two
 * categories:
 *
 *   1. **Currently routed** — every top-level `app/(app)/.../page.tsx`
 *      and `app/api/...` segment that lives at root today. If you
 *      didn't reserve these, a user picking `username = "files"` would
 *      collide with `/files`.
 *   2. **Reasonable future / generic** — short words we're likely to
 *      claim later (`help`, `team`, `enterprise`, etc.), plus common
 *      reserved-system handles (`admin`, `support`) that we wouldn't
 *      want anyone to impersonate.
 *
 * Add new entries here when you ship a new top-level route — the
 * validator in `lib/handles/validate.ts` enforces them.
 */
export const RESERVED_HANDLES = new Set<string>([
  // Auth + onboarding
  "sign-in",
  "sign-up",
  "sso-callback",
  "onboarding",
  // Core app sections
  "dashboard",
  "files",
  "projects",
  "collections",
  "materials",
  "orders",
  "print",
  "checkout",
  "search",
  // Account namespaces (old + new). `u` and `o` stay reserved so
  // `/u/connor` -style URLs (redirected to `/connor`) never collide
  // with a user whose handle is literally `u`.
  "u",
  "o",
  // API + infra
  "api",
  "_next",
  "static",
  "public",
  "assets",
  "fonts",
  "robots.txt",
  "sitemap.xml",
  "favicon.ico",
  "llms.txt",
  "llms-full.txt",
  // Future-proof claims — short, generic, likely to ship
  "about",
  "pricing",
  "help",
  "support",
  "contact",
  "blog",
  "docs",
  "team",
  "teams",
  "enterprise",
  "legal",
  "terms",
  "privacy",
  "settings",
  "account",
  "billing",
  "admin",
  "moderation",
  "explore",
  "trending",
  "new",
  // Disallow root + literal-empty edge cases — Next normalizes to ""
  // but we want a hard guard in case something slips through.
  "",
  "index",
]);

/**
 * Is the given candidate (lowercased) a reserved handle? Case-folded
 * comparison so we don't need to track casing variants in the set.
 */
export function isReservedHandle(candidate: string): boolean {
  return RESERVED_HANDLES.has(candidate.toLowerCase());
}
