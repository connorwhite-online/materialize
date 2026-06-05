import * as Sentry from "@sentry/nextjs";

/**
 * Report a HANDLED client-side failure to Sentry.
 *
 * Client Sentry only auto-captures UNHANDLED errors. Flows that catch
 * an error and surface it in the UI (uploads, direct-to-R2 PUTs, etc.)
 * otherwise produce ZERO telemetry — a full outage can look invisible
 * to monitoring, and the sentry-fixer agent loop (which keys off Sentry
 * issues) never fires. Call this at those catch points for failures
 * that are genuinely actionable.
 *
 * Use it for definitive failures — a real HTTP status from a dependency
 * — not transient navigation aborts / one-off network blips, which the
 * `ignoreErrors` noise floor in instrumentation-client.ts deliberately
 * mutes.
 *
 * Never throws: telemetry must not break the user flow.
 */
export function reportClientError(
  context: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  try {
    Sentry.withScope((scope) => {
      scope.setTag("context", context);
      if (extra) scope.setExtras(extra);
      if (error instanceof Error) {
        Sentry.captureException(error);
      } else {
        Sentry.captureMessage(`${context}: ${String(error)}`, "error");
      }
    });
  } catch {
    // Sentry not initialised / failed to load — swallow.
  }
}
