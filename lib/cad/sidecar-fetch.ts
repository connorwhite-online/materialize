import "server-only";

import { Agent } from "undici";

/**
 * Dispatcher for ALL sidecar HTTP calls (runner-client, session-client).
 *
 * Node's built-in fetch (undici) defaults to a 300s headers timeout. The
 * sidecar's per-exec ceiling is 600s (CAD_RUN_TIMEOUT_S — large TPMS builds
 * legitimately mesh for 5-7 minutes), so without this, undici hangs up at
 * exactly +300s with `TypeError: fetch failed` while the sidecar keeps
 * building. Observed in production of exactly this failure: a 438s build
 * finished watertight AND isolation-verified, and was thrown away at the
 * HTTP layer 138s after the socket died.
 *
 * 15min gives the 600s exec ceiling (plus checks + payload streaming) 1.5x
 * headroom. Keep this ABOVE the sidecar's CAD_RUN_TIMEOUT_S: the sidecar is
 * the authority on how long work may take; the transport must simply
 * outlive it.
 */
export const sidecarDispatcher = new Agent({
  headersTimeout: 15 * 60_000,
  bodyTimeout: 15 * 60_000,
});