/**
 * Extract the user-facing message from a Clerk API error.
 *
 * Clerk's backend SDK throws errors carrying a structured `errors[]`
 * array whose `longMessage` is written for end users ("Username must
 * be at least 4 characters long."). The thrown Error's own `message`
 * is just the HTTP status text — "Unprocessable Entity" — which tells
 * neither the user nor the on-call engineer anything.
 *
 * This bit us during the Clerk production migration: onboarding
 * failed with a flat "Failed to set username", Sentry recorded only
 * `Unprocessable Entity` at the updateUser call, and the actual
 * reason (a rejected username value) had to be guessed at. Server
 * actions that call Clerk should surface this instead of a generic
 * failure string.
 *
 * Returns null when the error isn't a Clerk API error (DB blip,
 * network, programmer error) — those must NOT be echoed to users, so
 * callers fall back to their own generic copy.
 */
export function clerkErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;

  const errors = (error as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;

  const first = errors[0];
  if (!first || typeof first !== "object") return null;

  const { longMessage, message } = first as {
    longMessage?: unknown;
    message?: unknown;
  };

  if (typeof longMessage === "string" && longMessage.trim()) {
    return longMessage;
  }
  if (typeof message === "string" && message.trim()) {
    return message;
  }
  return null;
}
