/**
 * Pure deterministic mapping from changed-file paths to Next app
 * router route patterns. Used by scripts/pr-browser-review.ts to
 * pre-seed the agent's scope decision so it doesn't burn turns
 * re-deriving what the path-parse already knows.
 *
 * Scope: only handles paths under `app/`. Component-import-graph
 * walking (figuring out which pages render a given
 * components/foo.tsx) is intentionally NOT here — that requires
 * cross-file AST parsing and the agent's grep is already good
 * enough for it. This module's job is the deterministic part.
 *
 * Output is a list of RouteImpact. Dynamic segments are preserved
 * as `[name]` in the path string — the agent is responsible for
 * substituting a real value (query the DB, hit a known sample) at
 * browse time.
 */
export type RouteImpactKind =
  | "page"
  | "layout"
  | "loading"
  | "error"
  | "not-found"
  | "api"
  | "metadata"
  | "template";

export interface RouteImpact {
  /** Route pattern with dynamic segments preserved, e.g. "/files/[slug]". */
  path: string;
  kind: RouteImpactKind;
  /** Source file that triggered this impact entry (changed file). */
  source: string;
  /**
   * True for layouts / templates / root files whose change blast
   * radius is the entire subtree below their position, not just one
   * route. The agent should pick a sample of children to verify.
   */
  affectsSubtree: boolean;
}

/** Files whose changes don't map to any route (utilities, tests, actions). */
const NON_ROUTE_APP_PREFIXES = [
  "app/actions/",
  "app/api/internal/", // webhook receivers — no browser surface
];

/**
 * Files inside `app/` that are NOT route-producing — server actions,
 * test files, etc.
 */
function isExcludedAppPath(rel: string): boolean {
  if (rel.includes("/__tests__/")) return true;
  if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return true;
  return NON_ROUTE_APP_PREFIXES.some((p) => rel.startsWith(p));
}

/**
 * Classify a Next app-router file by its filename. Returns null for
 * files that don't produce a route segment on their own (e.g. a
 * helper.ts under a route directory).
 */
function classifyFile(basename: string): RouteImpactKind | null {
  if (basename === "page.tsx" || basename === "page.ts") return "page";
  if (basename === "layout.tsx" || basename === "layout.ts") return "layout";
  if (basename === "loading.tsx" || basename === "loading.ts") return "loading";
  if (basename === "error.tsx" || basename === "error.ts") return "error";
  if (basename === "not-found.tsx" || basename === "not-found.ts")
    return "not-found";
  if (basename === "template.tsx" || basename === "template.ts")
    return "template";
  if (basename === "route.ts" || basename === "route.tsx") return "api";
  // Metadata files: opengraph-image, twitter-image, icon, favicon,
  // sitemap, robots — all generate URLs but the page itself isn't
  // really a "user surface" worth opening a browser at.
  if (
    basename.startsWith("opengraph-image") ||
    basename.startsWith("twitter-image") ||
    basename.startsWith("icon") ||
    basename === "favicon.ico" ||
    basename === "sitemap.ts" ||
    basename === "sitemap.tsx" ||
    basename === "robots.ts" ||
    basename === "robots.tsx"
  ) {
    return "metadata";
  }
  return null;
}

/**
 * Convert the directory segments of an app-router path to a URL
 * pattern. Drops route groups `(name)`, preserves dynamic
 * `[segment]` and catch-all `[...rest]` notation.
 *
 * Examples:
 *   app/(app)/files/[slug]/page.tsx → /files/[slug]
 *   app/page.tsx                    → /
 *   app/(auth)/sign-in/page.tsx     → /sign-in
 *   app/api/foo/route.ts            → /api/foo
 */
function dirToRoute(rel: string): string {
  // Drop "app/" prefix and the filename.
  const parts = rel.split("/").slice(1, -1);
  const filtered = parts.filter((seg) => !/^\(.+\)$/.test(seg));
  if (filtered.length === 0) return "/";
  return "/" + filtered.join("/");
}

/**
 * The root layout `app/layout.tsx` wraps every route; everything
 * else with `affectsSubtree` only affects its descendants.
 */
function isRootLayout(rel: string): boolean {
  return rel === "app/layout.tsx" || rel === "app/layout.ts";
}

/**
 * Map a list of changed files (paths relative to repo root) to the
 * set of distinct route impacts. De-duplicates by `${path}::${kind}`
 * so a page + loading + error change in the same dir collapses
 * sensibly while preserving the kind distinction.
 */
export function mapFilesToRoutes(changedFiles: string[]): RouteImpact[] {
  const seen = new Map<string, RouteImpact>();
  for (const rel of changedFiles) {
    if (!rel.startsWith("app/")) continue;
    if (isExcludedAppPath(rel)) continue;
    const basename = rel.split("/").pop() ?? "";
    const kind = classifyFile(basename);
    if (!kind) continue;
    const path = dirToRoute(rel);
    const affectsSubtree =
      kind === "layout" || kind === "template" || isRootLayout(rel);
    const key = `${path}::${kind}`;
    if (seen.has(key)) continue;
    seen.set(key, { path, kind, source: rel, affectsSubtree });
  }
  return [...seen.values()];
}

/**
 * Convenience formatter for embedding the impact list in a markdown
 * / prompt context block. Groups by kind for readability.
 */
export function formatRouteImpacts(impacts: RouteImpact[]): string {
  if (impacts.length === 0) {
    return "(no app-router files changed — likely a lib/, scripts/, or components/ change. Find consumers via grep before deciding scope.)";
  }
  const lines = impacts.map((r) => {
    const tail = r.affectsSubtree
      ? ` ← layout/template, affects entire subtree under ${r.path}`
      : "";
    return `- \`${r.path}\` (${r.kind}, from \`${r.source}\`)${tail}`;
  });
  return lines.join("\n");
}
