/**
 * Next.js standard instrumentation hook. Called once per process
 * (server + edge) at startup. We dispatch to the runtime-
 * appropriate Sentry config — they share PII scrubbing + tagging
 * but use different transports (Node vs. edge fetch).
 *
 * Also exports `onRequestError` so server-side rendering errors
 * funnel through Sentry the same way uncaught exceptions do.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
