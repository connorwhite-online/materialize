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

/**
 * Wrap Sentry's request-error handler to suppress benign connection-
 * abort errors before they reach the dashboard.
 *
 * Node.js fires `Error("aborted")` from `node:_http_server →
 * abortIncoming` whenever the client closes the connection while the
 * server is still processing — the user navigated away, closed the
 * tab, or the network dropped. This is routine browser behaviour, not
 * an application bug. Forwarding it to Sentry (Sentry event 7483761588)
 * creates noise with no in-app stack frames and no actionable signal.
 *
 * AbortController-generated errors (`error.name === "AbortError"`) are
 * the client-side analogue and are suppressed for the same reason.
 */
export const onRequestError: typeof Sentry.captureRequestError = (
  error,
  request,
  errorContext
) => {
  if (
    error instanceof Error &&
    (error.message === "aborted" || error.name === "AbortError")
  ) {
    return;
  }
  return Sentry.captureRequestError(error, request, errorContext);
};
