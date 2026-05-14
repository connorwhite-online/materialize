export function logError(context: string, error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null
        ? JSON.stringify(error)
        : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(`[${context}]`, message, stack ? `\n${stack}` : "");

  // Fan out to Sentry. Every existing `logError` call site now
  // also produces a structured event in the dashboard — no need
  // to sprinkle captureException calls throughout the codebase.
  //
  // Lazy-required so this module stays usable from edge contexts
  // and test setups that mock @/lib/logger without dragging in
  // the Sentry SDK. No-op when DSN isn't configured.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/nextjs") as typeof import("@sentry/nextjs");
    Sentry.withScope((scope) => {
      scope.setTag("context", context);
      if (error instanceof Error) {
        Sentry.captureException(error);
      } else {
        Sentry.captureMessage(`${context}: ${message}`, "error");
      }
    });
  } catch {
    // Sentry not installed or failed to load — skip silently. The
    // console.error above already preserved the signal.
  }
}

/**
 * Next.js implements navigation (redirect/notFound) by throwing magic
 * errors. A server action's `try/catch` will swallow them unless the
 * catch re-throws on this predicate — otherwise the redirect silently
 * becomes a generic error response.
 */
export function isRedirectError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("NEXT_REDIRECT") ||
    error.message.includes("REDIRECT")
  );
}
