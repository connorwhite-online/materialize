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
 * Renders NOTHING until it confirms the asset actually has a persisted STEP
 * object: `getCadStepDownloadUrl` returns `{ url: null }` for mesh-mode /
 * sdf_kit generations and every non-CAD upload, so mesh-only models show no
 * dead button (the acceptance criterion). Entitlement is enforced server-side
 * inside the action (mirrors the STL download: owner, org, collaborators,
 * buyers, free listings).
 *
 * Shared by the studio artifact panel and the file detail page; the caller
 * styles it via `className` so it matches whichever surface it sits in.
 */
export function StepDownloadLink({
  fileAssetId,
  className,
  label = "Download STEP (editable CAD)",
}: {
  fileAssetId: string;
  className?: string;
  label?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    // Callers that reuse this component across different assets (the studio
    // part switcher) pass a `key={fileAssetId}` so it remounts with fresh
    // null state — no synchronous reset needed here.
    let active = true;
    getCadStepDownloadUrl({ fileAssetId })
      .then((res) => {
        if (active && "url" in res && res.url) setUrl(res.url);
      })
      .catch(() => {
        // Best-effort: a failed probe simply hides the affordance.
      });
    return () => {
      active = false;
    };
  }, [fileAssetId]);

  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-foreground/15 px-4 py-2 text-sm hover:bg-foreground/5",
        className
      )}
    >
      <FileBoxIcon className="size-4 shrink-0" />
      {label}
    </a>
  );
}
