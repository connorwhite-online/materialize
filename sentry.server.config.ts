/**
 * Sentry initialization for the server runtime (Node).
 *
 * Loaded via instrumentation.ts when the request enters the
 * Node runtime — i.e. every server action, RSC, and Node-based
 * route handler. The edge runtime has its own config because
 * the Sentry SDK uses different transports per runtime.
 *
 * No-op when NEXT_PUBLIC_SENTRY_DSN is unset, so unconfigured
 * environments (fresh checkouts before secrets land in env)
 * still build and run cleanly.
 */
import * as Sentry from "@sentry/nextjs";
import { scrubPiiFromEvent } from "./lib/observability/scrub-pii";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Vercel injects the commit SHA at build time. Tagging every
    // event with the release version is what makes "started after
    // which deploy?" answerable in the Sentry dashboard.
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    // Trace 10% of transactions in prod; everything in dev. Tune
    // down if event volume hits the free-tier ceiling.
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // Attach local variable values to server-side stack frames.
    // Modest CPU + memory cost; pays for itself the first time a
    // captured event lets you see what `userId` was when the
    // throw happened, instead of staring at a generic stack.
    includeLocalVariables: true,
    // Enable Sentry Logs so `logger.info` / `logger.error` calls
    // become structured log entries correlated with their parent
    // trace. The captureException fan-out from lib/logger.ts is
    // independent — both channels carry the signal.
    enableLogs: true,
    // Capture the surrounding request context (headers, query) but
    // drop bodies — request payloads can carry user-supplied
    // content + sensitive fields we'd rather not push to Sentry.
    sendDefaultPii: false,
    beforeSend: scrubPiiFromEvent,
    // Bury noisy framework errors that don't represent real bugs.
    ignoreErrors: [
      // Next's NEXT_NOT_FOUND / NEXT_REDIRECT throw to control
      // flow — not actual exceptions.
      /^NEXT_(NOT_FOUND|REDIRECT|HTTP_ERROR_FALLBACK)/,
    ],
  });
}
