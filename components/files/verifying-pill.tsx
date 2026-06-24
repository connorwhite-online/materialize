"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// 6s, not 3s: the geometry fingerprint usually lands in 1-3s, so the
// first or second poll still catches it, but each poll is a full
// `router.refresh()` that re-runs the DB-backed listing server
// component — halving the cadence halves that per-upload Neon query
// burst with no meaningful hit to perceived latency.
const POLL_INTERVAL_MS = 6_000;
const POLL_TIMEOUT_MS = 60_000;

/**
 * Owner-only soft-pending indicator on the listing page. Visible while
 * the deferred geometry-fingerprint pass scheduled in app/actions/files.ts
 * hasn't written `geometry_hash` yet — usually 1-3s after upload, but
 * can stretch to a few minutes if the function instance was killed and
 * the cron sweep has to pick it up.
 *
 * Polls `router.refresh()` every 3s until the parent page re-renders
 * without us (i.e. geometry_hash is now populated, so the parent
 * unmounts this component). 60s ceiling so we don't burn refreshes
 * forever on a parse failure — at that point the pill stays visible
 * until the next manual navigation.
 *
 * Cheap: router.refresh re-runs the server component but doesn't
 * remount the client tree, so the page doesn't visibly flicker.
 */
export function VerifyingPill() {
  const router = useRouter();
  const startedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - startedAtRef.current > POLL_TIMEOUT_MS) {
        clearInterval(id);
        return;
      }
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
    >
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
      Verifying upload
    </span>
  );
}
