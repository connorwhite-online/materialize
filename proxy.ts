import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sso-callback",
  "/files(.*)",
  "/materials(.*)",
  "/print(.*)",
  "/collections(.*)",
  "/projects(.*)",
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
]);

export default clerkMiddleware(async (auth, req) => {
  // Tag the Sentry scope with the authed Clerk userId so any
  // errors captured downstream (edge + node runtimes via the
  // request-scoped AsyncLocalStorage that @sentry/nextjs sets up)
  // include the user id. Opaque id only — no email, no name; PII
  // scrubbing in `beforeSend` still applies.
  //
  // We tag BEFORE auth.protect() so anonymous-route errors stay
  // untagged (correct — there's no user) and auth-failure errors
  // on protected routes get tagged with whoever was attempting.
  try {
    const { userId } = await auth();
    if (userId) {
      Sentry.setUser({ id: userId });
    }
  } catch {
    // auth() can fail in some pre-request paths; silently skip
    // the tag rather than block the request.
  }
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|stl|glb|gltf|obj|3mf)).*)",
    "/(api|trpc)(.*)",
  ],
};
