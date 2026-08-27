/**
 * Routes reachable without a Clerk session.
 *
 * Extracted from `proxy.ts` so it can be tested. It previously listed
 * `/text-to-cad(.*)` for a route that had been renamed to
 * `/prometheus` — a stale string nothing could catch, which quietly
 * pushed `/prometheus/eval` and `/prometheus/exemplars` into
 * `auth.protect()` and redirected anonymous visitors to sign-in
 * instead of 404ing: the exact disclosure that entry existed to
 * prevent. `lib/auth/__tests__/public-routes.test.ts` now pins the
 * behaviour, so the next rename fails a test rather than a threat
 * model.
 *
 * "Public" here means public *at the proxy layer* only. Several of
 * these routes carry their own gate and are listed precisely so that
 * gate can run — an owner-only page must 404 for a stranger, and
 * `auth.protect()` would redirect them to sign-in, which tells them
 * the route exists.
 */
export const PUBLIC_ROUTES = [
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sso-callback",
  "/files(.*)",
  "/materials(.*)",
  "/print(.*)",
  "/collections(.*)",
  "/projects(.*)",
  // Owner-gated surfaces: the Prometheus studio + scorecard, and the
  // operator tools under /internal. Public at the proxy layer so each
  // page runs its own gate and notFound()s for everyone else — reaching
  // auth.protect() instead would redirect anonymous visitors to
  // sign-in, revealing that the route exists rather than 404ing.
  //
  // The single-segment matcher at the bottom of this list already lets
  // `/prometheus` through (it looks like a vanity profile); these
  // entries are what cover the SUB-routes — `/prometheus/eval`,
  // `/prometheus/exemplars`, `/internal/discovery`. This entry read
  // `/text-to-cad(.*)` until the route was renamed to `/prometheus`,
  // which is exactly the disclosure it was written to prevent: the
  // sub-routes were redirecting to sign-in.
  "/prometheus(.*)",
  "/internal(.*)",
  // Two-step checkout's post-payment landing. Public at the middleware
  // layer because Stripe's success redirect can arrive in a browser
  // context with no Clerk session (iOS PWA in-app overlay has an
  // isolated cookie jar) — auth.protect() there triggers Clerk's
  // redirect handshake, which fails inside the webview. The page does
  // its own gate: a signed per-order token (minted into the success
  // URL) or the normal signed-in ownership check. Other /orders/[id]/*
  // pages (confirm, cancel) stay protected.
  "/orders/:orderId/pay-production",
  "/u/(.*)",
  "/api/webhooks(.*)",
  "/api/craftcloud/(.*)",
  // Anon home-bar search hits this; protecting it breaks the search
  // panel for signed-out visitors.
  "/api/search(.*)",
  // Vercel cron calls authenticate via the CRON_SECRET header — they
  // arrive without a Clerk session and would otherwise rewrite to /404.
  "/api/cron/(.*)",
  // Public thumbnails for marketplace listings.
  "/api/thumbnails(.*)",
  // Same-origin proxy for the 3D model preview on published file
  // pages. The route itself enforces published-or-owner access.
  "/api/files/preview/(.*)",
  // MCP server. The transport route (app/api/[transport]/route.ts)
  // does its own bearer-token auth via withMcpAuth — Clerk session
  // cookies are not relevant here.
  "/api/mcp(.*)",
  // Sentry SDK tunnels client error reports through this same-
  // origin route so ad-blockers don't drop them. No Clerk session
  // expected. Configured in next.config.ts → tunnelRoute.
  "/api/monitoring/(.*)",
  // Sentry wiring smoke probe. The route itself enforces a
  // secret-header check + non-production gate.
  "/api/internal/sentry-test",
  // Sentry-fixer webhook. Posts arrive without a Clerk session;
  // the route validates a shared secret header.
  "/api/internal/sentry-trigger",
  // Discovery surfaces for crawlers + AI agents.
  "/llms.txt",
  "/llms-full.txt",
  "/robots.txt",
  "/sitemap.xml",
  // Public user / org vanity profiles live at the root: `/[handle]`
  // (the canonical target the old `/u/[username]` + `/o/[slug]` routes
  // now redirect to). A profile is a single root segment, so match
  // exactly one segment and exclude the authed root routes
  // (dashboard / checkout / orders / onboarding) so they stay gated.
  /^\/(?!(?:dashboard|checkout|orders|onboarding|sign-in|sign-up|sso-callback|api)(?:[/?#]|$))[^/?#]+\/?$/,
] as const;
