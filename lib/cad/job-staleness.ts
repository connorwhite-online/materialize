/**
 * When a CAD job's executor dies without a terminal write (Vercel kills the
 * generate route's after() at maxDuration=300s, OOM, crash), the row stays
 * `running`/`queued`. The events SSE keeps sending `: ping` frames, so the
 * studio looks alive even for a user who never leaves the page — until this
 * reap-on-read bound fires.
 *
 * Must sit just past generate's maxDuration=300s. The executor also self-
 * timeouts at ~270s (jobComputeBudgetMs) and should write a clean failure
 * first; this is the backup.
 */
export const STALE_RUNNING_MS = 6 * 60_000;

/** True when a non-terminal job is older than the executor's hard ceiling. */
export function isStaleCadJob(
  born: Date | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!born) return false;
  return nowMs - born.getTime() > STALE_RUNNING_MS;
}

export const STALE_JOB_ERROR =
  "This build stopped before finishing — the server hit its " +
  "time limit. Simplify the script (apply fillets in one " +
  "batch, never edge-by-edge) or split into parts, then try again.";
