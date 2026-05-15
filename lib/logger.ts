/**
 * `JSON.stringify` throws on circular references. The error path
 * is the worst place to throw, so wrap and fall back to `String()`
 * — `[object Object]` is still better than crashing logError().
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * True for errors that signal an HTTP connection abort, not an
 * application bug:
 *
 *  - `Error("aborted")` — emitted by Node.js `node:_http_server`
 *    via `abortIncoming` when the client disconnects while the
 *    server is still processing a request (user navigated away,
 *    closed the tab, network dropped). Sentry event 7483761588.
 *  - `DOMException("AbortError")` — thrown by the Fetch API (and
 *    our own `wait()` helper in poll-quotes.ts) when an
 *    AbortController signal fires.
 *
 * Neither represents a real application failure; both are routine
 * browser behaviour. Logging them to Sentry creates noise without
 * actionable signal.
 */
function isConnectionAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message === "aborted" || error.name === "AbortError";
}

/**
 * Keys in a context object that we promote to Sentry *tags* (not
 * just extras) so the dashboard can filter / group by them.
 *
 * Tag cardinality matters — Sentry indexes every distinct value
 * per tag, and unbounded tag dimensions get expensive fast. Keep
 * this list to domain ids that have natural cardinality bounds
 * (users, listings, orders) rather than open strings (URLs,
 * messages). Add sparingly.
 */
const PROMOTE_TO_TAG = new Set<string>([
  // Identity
  "userId",
  "buyerId",
  "creatorId",
  "ownerUserId",
  // Domain entities
  "fileId",
  "fileAssetId",
  "projectId",
  "listingId",
  "orderId",
  "printOrderId",
  "purchaseId",
  "cartItemId",
  "vendorId",
  "materialConfigId",
  // External system ids
  "stripeAccountId",
  "stripePaymentIntentId",
  "stripeSessionId",
  "craftCloudOrderId",
  // Status / error codes — useful for "all 404s" style queries
  "status",
  "statusCode",
  "code",
  "errorCode",
]);

/**
 * Coerce a primitive (string / number / boolean) to a Sentry tag
 * value. Sentry tags must be strings; we reject objects/arrays
 * (they belong in `extras` not `tags`) and skip null/undefined
 * (they'd just show as empty).
 */
function tagValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/**
 * Pure function — given a context string and an error/payload,
 * compute the Sentry scope enrichment we'd apply. Exposed so the
 * logic is testable without mocking the Sentry SDK; `logError`
 * below is the only real caller.
 */
export interface SentryEnrichment {
  /** Tags to set on the scope. `context` is always included. */
  tags: Record<string, string>;
  /** Extras to set on the scope (queryable, not indexed). */
  extras: Record<string, unknown>;
}

export function buildSentryEnrichment(
  context: string,
  error: unknown
): SentryEnrichment {
  const tags: Record<string, string> = { context };
  const extras: Record<string, unknown> = {};

  // Plain-object payload — the common shape for `logError(ctx, { …fields })`.
  if (
    typeof error === "object" &&
    error !== null &&
    !(error instanceof Error)
  ) {
    const obj = error as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      extras[key] = obj[key];
      if (!PROMOTE_TO_TAG.has(key)) continue;
      const v = tagValue(obj[key]);
      if (v !== null) tags[key] = v;
    }
  }

  // Error with a structured cause — `new Error(msg, { cause: {...} })`.
  if (
    error instanceof Error &&
    typeof error.cause === "object" &&
    error.cause !== null
  ) {
    const causeObj = error.cause as Record<string, unknown>;
    extras.cause = causeObj;
    for (const key of Object.keys(causeObj)) {
      if (!PROMOTE_TO_TAG.has(key)) continue;
      const v = tagValue(causeObj[key]);
      if (v !== null) tags[key] = v;
    }
  }

  return { tags, extras };
}

export function logError(context: string, error: unknown) {
  // Connection-abort errors are benign (client navigated away, network
  // dropped, tab closed). Skip console + Sentry entirely so they don't
  // pollute the error dashboard with non-actionable events. The
  // ignoreErrors filter in sentry.server.config.ts catches the same
  // class at the SDK layer as a backstop; this early-return saves the
  // round-trip in addition to suppressing the console noise.
  if (isConnectionAbort(error)) return;

  const isPlainObject =
    typeof error === "object" &&
    error !== null &&
    !(error instanceof Error);
  const message =
    error instanceof Error
      ? error.message
      : isPlainObject
        ? safeStringify(error)
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
    const { tags, extras } = buildSentryEnrichment(context, error);
    Sentry.withScope((scope) => {
      for (const [k, v] of Object.entries(tags)) scope.setTag(k, v);
      if (Object.keys(extras).length > 0) scope.setExtras(extras);
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
