"use client";

import { useEffect, useState } from "react";
import { FileBoxIcon } from "lucide-react";

import { getCadStepDownloadUrl } from "@/app/actions/cad-generation";
import { cn } from "@/lib/utils";

/**
 * "Download STEP (editable CAD)" affordance (MTR-196). STEP is the editable
 * B-rep source — a real value-add over a triangle-soup STL (buyers/owners get
 * parametric-adjacent CAD they can open in any kernel).
 *
 * Entitlement is enforced server-side inside `getCadStepDownloadUrl` (mirrors
 * the STL download: owner, org, collaborators, buyers, free listings), which
 * returns `{ url: null }` for mesh-mode / sdf_kit generations and every
 * non-CAD upload — so a mesh-only model never shows a dead button.
 *
 * **Presence (MTR-215).** Pass `available` when the caller *already knows*
 * whether a STEP exists (the studio threads `hasStep` with the turn/part):
 *   • `available === false` → render nothing, immediately (no probe, no slot).
 *   • `available === true`  → render the button from first paint, disabled while
 *     it fetches the signed URL, then enabled — the slot never shifts.
 *   • `available === undefined` → legacy self-probing: mounts empty and appears
 *     once the probe confirms a STEP. Kept for callers (the file detail page)
 *     that don't thread the signal; the studio always passes it so its action
 *     row is stable and nothing pops in late.
 *
 * Shared by the studio artifact panel and the file detail page; the caller
 * styles it via `className` so it matches whichever surface it sits in.
 */
export function StepDownloadLink({
  fileAssetId,
  className,
  label = "Download STEP (editable CAD)",
  available,
}: {
  fileAssetId: string;
  className?: string;
  label?: string;
  available?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);

  // Known-absent: never render, so there's no slot to reflow.
  const known = available !== undefined;

  useEffect(() => {
    // Skip the probe entirely when we're told there's no STEP.
    if (known && !available) return;
    // Callers that reuse this component across different assets (the studio
    // part switcher) pass a `key={fileAssetId}` so it remounts with fresh
    // null state — no synchronous reset needed here.
    let active = true;
    getCadStepDownloadUrl({ fileAssetId })
      .then((res) => {
        if (active && "url" in res && res.url) setUrl(res.url);
      })
      .catch(() => {
        // Best-effort: a failed probe simply leaves the button disabled (when
        // we knew a STEP exists) or hidden (legacy probe path).
      });
    return () => {
      active = false;
    };
  }, [fileAssetId, known, available]);

  if (known && !available) return null;
  // Legacy path: stay hidden until the probe resolves a URL.
  if (!known && !url) return null;

  const baseClass = cn(
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-foreground/15 px-4 py-2 text-sm",
    className
  );

  // Known-present but the signed URL is still resolving: hold the slot with a
  // disabled button of the exact final width so enabling it causes no shift.
  if (!url) {
    return (
      <span
        aria-disabled
        className={cn(baseClass, "cursor-default opacity-60")}
      >
        <FileBoxIcon className="size-4 shrink-0" />
        {label}
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(baseClass, "cursor-pointer hover:bg-foreground/5")}
    >
      <FileBoxIcon className="size-4 shrink-0" />
      {label}
    </a>
  );
}
