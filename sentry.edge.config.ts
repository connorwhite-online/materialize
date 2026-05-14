/**
 * Sentry initialization for the edge runtime.
 *
 * Same shape as `sentry.server.config.ts` but uses the edge
 * transport (no Node `http` module). Loaded by the proxy
 * (middleware) and any `runtime: "edge"` route handler. Today
 * that's just `proxy.ts` — most of our API routes are Node.
 */
import * as Sentry from "@sentry/nextjs";
import { scrubPiiFromEvent } from "./lib/observability/scrub-pii";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // Sentry Logs correlation — see the server config for context.
    // Edge runtime doesn't support `includeLocalVariables`.
    enableLogs: true,
    sendDefaultPii: false,
    beforeSend: scrubPiiFromEvent,
    ignoreErrors: [
      /^NEXT_(NOT_FOUND|REDIRECT|HTTP_ERROR_FALLBACK)/,
    ],
  });
}
