/**
 * Sentry initialization for the browser runtime. Picked up
 * automatically by Next 16 via the file name; we don't import
 * this anywhere ourselves.
 *
 * The replay integration is intentionally NOT included here —
 * Sentry's session replay is a separate paid product and would
 * make every page load ship the replay SDK (~30KB). Add it
 * later if reproducing client-side bugs from breadcrumbs alone
 * becomes the bottleneck.
 */
import * as Sentry from "@sentry/nextjs";
import { scrubPiiFromEvent } from "./lib/observability/scrub-pii";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    environment:
      process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    enableLogs: true,
    sendDefaultPii: false,
    beforeSend: scrubPiiFromEvent,
    ignoreErrors: [
      /^NEXT_(NOT_FOUND|REDIRECT|HTTP_ERROR_FALLBACK)/,
      // Browser noise — quota-exceeded from LocalStorage,
      // ResizeObserver loop notifications, etc.
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "Non-Error promise rejection captured",
      // Fetch aborts (navigation cancels in-flight request) and
      // network failures that aren't actionable from app code.
      // Real failures will re-fire on the user's next attempt; one-
      // off network blips dominate the noise floor otherwise.
      /^AbortError/,
      /The user aborted a request/,
      /Failed to fetch/,
      /NetworkError when attempting to fetch/,
      /Load failed/, // Safari's stand-in for "Failed to fetch"
      // Browser extensions injecting scripts that throw — never
      // our code, never actionable.
      /chrome-extension:/,
      /moz-extension:/,
      /safari-extension:/,
    ],
  });
}

// Required for nav-transaction tracing in app router. Internal
// detail of @sentry/nextjs.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
