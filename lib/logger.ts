export function logError(context: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(`[${context}]`, message, stack ? `\n${stack}` : "");
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
