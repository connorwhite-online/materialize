import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
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
  disableLogger: true,
});
