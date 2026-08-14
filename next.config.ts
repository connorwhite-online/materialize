import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { withIterate } from "iterate-ui-next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    /**
     * Prefer AVIF (then WebP) for the anon-home 4K hero masters and
     * everything else that flows through `/_next/image`. AVIF cuts
     * transfer size substantially on photographic art at quality 75;
     * WebP remains the fallback for browsers that don't take AVIF.
     * Each format is cached separately, which is fine for a small set
     * of static marketing assets.
     */
    formats: ["image/avif", "image/webp"],
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
  /**
   * SEC-2 — baseline security response headers. Applied to every
   * route (`source: "/(.*)"`).
   *
   * - X-Content-Type-Options: nosniff — stops the browser from
   *   sniffing a response's content type; complements the per-route
   *   nosniff already set on the thumbnail proxies (SEC-1).
   * - Referrer-Policy: strict-origin-when-cross-origin — trims the
   *   referrer sent cross-origin to just the origin.
   * - X-Frame-Options: DENY — this app never needs to be embedded in
   *   someone else's frame. Checked for conflicts first: the only
   *   `<iframe>` in the codebase is outbound (Wokwi circuit sim
   *   embedded IN our page, components/circuits/circuit-lightbox.tsx)
   *   and KiCanvasViewer renders same-origin — neither is affected by
   *   this app's own X-Frame-Options, which only governs whether WE
   *   can be framed by someone else.
   * - Content-Security-Policy-Report-Only — intentionally permissive
   *   (report-only, no report-uri) so it observes without breaking
   *   anything; a future pass can tighten it to enforcing once the
   *   report data is reviewed.
   */
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy-Report-Only",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: wss:; frame-src https:; worker-src 'self' blob:; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

/**
 * `withSentryConfig` does two things at build time when its env
 * vars are set: uploads source maps so Sentry stack traces resolve
 * to original TypeScript instead of the Vercel-built JS, and tunnels
 * client error reports through a same-origin route so ad-blockers
 * don't drop them. Both are no-ops when SENTRY_AUTH_TOKEN is unset,
 * so unconfigured environments still build cleanly.
 */
export default withIterate(withSentryConfig(nextConfig, {
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
  // Auto-instruments the routes wired in vercel.json's `crons` array as
  // Sentry Cron Monitors, so a sweep that never runs (Vercel kills it
  // mid-execution, the schedule silently stops firing, etc.) shows up
  // as a missed check-in instead of going unnoticed (MTR-144).
  automaticVercelMonitors: true,
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
}), { disableBabelPlugin: true });
