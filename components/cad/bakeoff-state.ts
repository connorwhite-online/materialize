import type { CadEngineId } from "@/lib/cad/engines";
import type { CadStreamEvent } from "@/lib/cad/types";

/**
 * Pure state reduction for one arm of an engine bake-off.
 *
 * Extracted from the panel for the same reason mobile-nav-destinations.ts and
 * studio-frame.ts are: the interesting logic is a small total function over
 * an event stream, and it is worth unit-testing without mounting React or
 * standing up SSE. The panel is then just rendering.
 */

export type BakeoffStatus = "queued" | "running" | "done" | "error";

export interface BakeoffPane {
  engine: CadEngineId;
  generationId: string;
  jobId: string;
  status: BakeoffStatus;
  /** "generating" (model writing code) or "executing" (sidecar running it). */
  phase?: "generating" | "executing";
  attempt?: number;
  maxAttempts?: number;
  /** Live in-progress render, replaced by renderUrl once the job lands. */
  snapshotPng?: string | null;
  renderUrl?: string | null;
  fileSlug?: string;
  sourceCode?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export function initialPane(run: {
  engine: CadEngineId;
  generationId: string;
  jobId: string;
}): BakeoffPane {
  return { ...run, status: "queued", startedAt: Date.now() };
}

/**
 * Fold one stream event into a pane. Total and immutable: an unrecognised
 * event returns the state unchanged rather than throwing, because the stream
 * carries events this surface has no opinion about (references, usage,
 * questions) and a bake-off pane must not fall over on one of them.
 *
 * TERMINAL IS STICKY. A late `snapshot` can arrive after `done` — the events
 * route replays persisted progress and re-emits the last snapshot on
 * reconnect — and letting that flip a finished pane back to "running" would
 * both lose the result and corrupt the elapsed time the comparison is for.
 */
export function reduceBakeoffEvent(
  pane: BakeoffPane,
  event: CadStreamEvent,
  now: number = Date.now()
): BakeoffPane {
  if (pane.status === "done" || pane.status === "error") return pane;

  switch (event.type) {
    case "queued":
      return { ...pane, status: "queued" };
    case "phase":
      return {
        ...pane,
        status: "running",
        phase: event.phase,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
      };
    case "repairing":
      return { ...pane, status: "running" };
    case "snapshot":
      return {
        ...pane,
        status: "running",
        snapshotPng: (event as { png?: string }).png ?? pane.snapshotPng,
      };
    case "done":
      return {
        ...pane,
        status: "done",
        renderUrl: event.renderUrl,
        fileSlug: event.fileSlug,
        sourceCode: event.sourceCode,
        finishedAt: now,
      };
    case "error":
      return { ...pane, status: "error", error: event.error, finishedAt: now };
    default:
      return pane;
  }
}

/** Wall-clock so far, or the final duration once the arm has landed. */
export function elapsedMs(pane: BakeoffPane, now: number = Date.now()): number {
  return (pane.finishedAt ?? now) - pane.startedAt;
}

/**
 * Which arm won, once BOTH have landed — never before. Reporting a winner
 * while the other arm is still running would just be reporting which one
 * finished first, which is the opposite of the comparison's point when the
 * slower engine is the one that succeeds.
 */
export function bakeoffVerdict(panes: BakeoffPane[]): {
  settled: boolean;
  winner: CadEngineId | null;
  reason: string;
} {
  const settled = panes.every((p) => p.status === "done" || p.status === "error");
  if (!settled) return { settled: false, winner: null, reason: "still running" };

  const succeeded = panes.filter((p) => p.status === "done");
  if (succeeded.length === 0)
    return { settled: true, winner: null, reason: "both failed" };
  if (succeeded.length === 1)
    return {
      settled: true,
      winner: succeeded[0].engine,
      reason: "only engine to produce a valid mesh",
    };

  // Both produced a mesh: the tiebreak is time, and it is only a tiebreak.
  // Quality is a human call from the two renders — a faster ugly part is not
  // the better part, so this never claims more than it measured.
  const fastest = succeeded.reduce((a, b) =>
    elapsedMs(a) <= elapsedMs(b) ? a : b
  );
  return {
    settled: true,
    winner: fastest.engine,
    reason: "both succeeded — faster to a valid mesh; judge quality yourself",
  };
}
