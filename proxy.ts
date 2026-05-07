import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

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
  // Discovery surfaces for crawlers + AI agents.
  "/llms.txt",
  "/llms-full.txt",
  "/robots.txt",
  "/sitemap.xml",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
