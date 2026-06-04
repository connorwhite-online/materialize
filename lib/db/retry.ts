import "server-only";

/**
 * Transient connection-failure handling for the Neon serverless
 * (WebSocket) driver.
 *
 * The `Pool` in `lib/db/index.ts` keeps idle connections warm across
 * requests in the same Node instance, and Neon reaps stale ones
 * server-side. When a request lands on a connection Neon just reaped,
 * the very next query throws a connection-class error
 * ("Connection terminated", "Connection closed", ECONNRESET, "socket
 * hang up", …) before the pool dials a fresh socket. The *next* query
 * on that pool succeeds, so a single retry makes the reap invisible.
 *
 * This is read-only by contract: only wrap idempotent SELECT loaders.
 * Never wrap writes — retrying a non-idempotent INSERT/UPDATE after an
 * ambiguous failure risks double-applying it.
 */

const CONNECTION_ERROR_PATTERNS: RegExp[] = [
  /connection (closed|terminated|reset|refused)/i,
  /terminating connection/i,
  /connection terminated unexpectedly/i,
  /server closed the connection unexpectedly/i,
  /socket hang up/i,
  /fetch failed/i, // neon-http transport / undici layer
  /timeout exceeded when trying to connect/i,
  /Client (was closed|has encountered a connection error)/i,
];

const CONNECTION_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  // Postgres admin/shutdown classes that surface as a dropped socket.
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "08006", // connection_failure
  "08003", // connection_does_not_exist
  "08001", // sqlclient_unable_to_establish_sqlconnection
]);

/**
 * True for errors that signal a dropped/stale DB connection (as
 * opposed to a real query error like a constraint violation or a bug).
 * Walks the `cause` chain since drivers often wrap the socket error.
 */
export function isTransientConnectionError(error: unknown): boolean {
  let current: unknown = error;
  // Bound the walk so a self-referential cause can't loop forever.
  for (let depth = 0; current != null && depth < 8; depth++) {
    if (typeof current === "object") {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && CONNECTION_ERROR_CODES.has(code)) {
        return true;
      }
    }
    const message =
      current instanceof Error
        ? current.message
        : typeof current === "string"
          ? current
          : "";
    if (message && CONNECTION_ERROR_PATTERNS.some((re) => re.test(message))) {
      return true;
    }
    current =
      current instanceof Error
        ? (current.cause as unknown)
        : undefined;
  }
  return false;
}

/**
 * Run a read-only DB thunk, retrying once (by default) on a transient
 * connection error so a reaped Neon socket re-dials transparently.
 * Re-throws immediately for any non-connection error — those are real
 * and retrying would just delay the failure.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; baseDelayMs?: number }
): Promise<T> {
  const retries = opts?.retries ?? 1;
  const baseDelayMs = opts?.baseDelayMs ?? 50;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isTransientConnectionError(error)) {
        throw error;
      }
      // Brief linear backoff to let the pool establish a fresh socket.
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * (attempt + 1))
      );
    }
  }
  throw lastError;
}
