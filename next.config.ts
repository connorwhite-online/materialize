import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    /**
     * Next.js 16 breaking change: when `localPatterns` is absent the
     * framework defaults to `[{ pathname: "**", search: "" }]`, which
     * blocks ALL local image URLs that carry a query string from the
     * built-in image-optimisation pipeline (`/_next/image`).
     *
     * Our thumbnail routes use query strings for photo selection:
     *   /api/thumbnails/{fileId}?photoId={photoId}
     *   /api/thumbnails/projects/{projectId}?photoId={photoId}
     *
     * Omitting `search` from a pattern allows any query string for that
     * path, which is the correct behaviour — the `photoId` values are
     * opaque DB UUIDs that users cannot enumerate from the outside.
     *
     * Providing `localPatterns` replaces the default entirely (not
     * merges), so we re-state the default rule for every other local
     * image path so static assets / icons keep optimizing.
     *
     * See: https://nextjs.org/docs/messages/next-image-unconfigured-localpatterns
     * Sentry: 7484236094
     */
    localPatterns: [
      {
        pathname: "/api/thumbnails/**",
        // No `search` property → allows any (or no) query string.
      },
      { pathname: "/**", search: "" },
    ],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
      {
        protocol: "https",
        hostname: "**.r2.cloudflarestorage.com",
      },
      {
        protocol: "https",
        hostname: "staticmap.openstreetmap.de",
      },
      {
        // CraftCloud's CDN — used for material catalog featured
        // images (resolveCatalogImage in search-results-panel and
        // friends).
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },
  serverExternalPackages: ["@neondatabase/serverless"],
};

/**
 * `withSentryConfig` does two things at build time when its env
 * vars are set: uploads source maps so Sentry stack traces resolve
 * to original TypeScript instead of the Vercel-built JS, and tunnels
 * client error reports through a same-origin route so ad-blockers
 * don't drop them. Both are no-ops when SENTRY_AUTH_TOKEN is unset,
 * so unconfigured environments still build cleanly.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Explicit instead of letting the SDK fish for the env var —
  // makes the dependency discoverable in source. Build still
  // succeeds without it; only source map upload is skipped.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // Same-origin tunnel for client error reports. Keeps ad-blockers
  // from silently dropping events.
  tunnelRoute: "/api/monitoring/tunnel",
  // Source maps go to Sentry but get deleted from the build
  // output afterwards — they're not served from the deployment,
  // only resolved server-side when Sentry renders a stack.
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  // `disableLogger` used to live here but is deprecated; the
  // documented replacement (`webpack.treeshake.removeDebugLogging`)
  // is webpack-only and we're on Turbopack, so there's nothing
  // equivalent to flip. The SDK's own debug logging stays at its
  // default verbosity, which is fine.
});
