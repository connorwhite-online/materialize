import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Sentry `beforeSend` hook — runs on every event before it
 * leaves the runtime. We strip the fields most likely to carry
 * user PII so the Sentry dashboard stays usable without legal
 * fallout, and so a leaked Sentry token doesn't leak our users'
 * inboxes.
 *
 * Scrub scope:
 *   - request.headers: drop `cookie`, `authorization`, `x-clerk-*`
 *   - request.data (body): redact `email`, `phoneNumber`, anything
 *     that looks like an `@` address
 *   - breadcrumbs: redact email-shaped strings from `message` /
 *     `data` payloads
 *   - user: keep `id` (Clerk userId is opaque and useful for
 *     reproducing), drop `email` / `username` / `ip_address`
 *
 * The function returns the (mutated) event or `null` to drop it
 * entirely. We never return null today — better to surface a
 * scrubbed event than to lose visibility into a real bug.
 */
const EMAIL_REGEX = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi;
const REDACTED = "[redacted]";

function redactEmails(input: string): string {
  return input.replace(EMAIL_REGEX, REDACTED);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function redactObject(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const lk = key.toLowerCase();
    if (
      lk === "email" ||
      lk === "emailaddress" ||
      lk === "phone" ||
      lk === "phonenumber" ||
      lk === "password" ||
      lk === "token" ||
      lk === "secret"
    ) {
      out[key] = REDACTED;
    } else if (typeof value === "string") {
      out[key] = redactEmails(value);
    } else if (Array.isArray(value)) {
      out[key] = value.map((v) =>
        typeof v === "string"
          ? redactEmails(v)
          : isPlainObject(v)
            ? redactObject(v)
            : v
      );
    } else if (isPlainObject(value)) {
      out[key] = redactObject(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function scrubPiiFromEvent(
  event: ErrorEvent,
  _hint: EventHint
): ErrorEvent | null {
  // user — keep the opaque Clerk id, drop the rest.
  if (event.user) {
    event.user = { id: event.user.id };
  }

  // request headers — drop the secret-bearing ones outright.
  if (event.request?.headers && typeof event.request.headers === "object") {
    const headers = { ...(event.request.headers as Record<string, string>) };
    for (const key of Object.keys(headers)) {
      const lk = key.toLowerCase();
      if (
        lk === "cookie" ||
        lk === "authorization" ||
        lk.startsWith("x-clerk-")
      ) {
        headers[key] = REDACTED;
      }
    }
    event.request.headers = headers;
  }

  // request body — redact field-shaped PII recursively.
  if (event.request?.data && isPlainObject(event.request.data)) {
    event.request.data = redactObject(event.request.data);
  }

  // breadcrumbs — strings get email-redacted in place; structured
  // data goes through the same recursive scrub.
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((bc) => {
      const next = { ...bc };
      if (typeof next.message === "string") {
        next.message = redactEmails(next.message);
      }
      if (next.data && isPlainObject(next.data)) {
        next.data = redactObject(next.data);
      }
      return next;
    });
  }

  // exception values — the Error.message of each captured exception.
  // Call sites that embed user-supplied strings in error messages
  // (e.g. `new Error(\`User ${email} not found\`)`) would otherwise
  // expose PII directly in the Sentry event's primary message field.
  if (Array.isArray(event.exception?.values)) {
    event.exception!.values = event.exception!.values.map((ex) => {
      if (typeof ex.value === "string") {
        return { ...ex, value: redactEmails(ex.value) };
      }
      return ex;
    });
  }

  // top-level message — used by captureMessage() calls (non-Error
  // paths through logError). Same risk: the message string is
  // assembled from context that might include a user email.
  if (typeof event.message === "string") {
    event.message = redactEmails(event.message);
  }

  return event;
}
