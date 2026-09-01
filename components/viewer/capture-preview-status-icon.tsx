import { CheckCircleFilled } from "@/components/icons/check-circle-filled";
import { DottedSpinner } from "@/components/icons/dotted-spinner";
import { FrameCorners } from "@/components/icons/frame-corners";

export type CapturePreviewStatus = "idle" | "capturing" | "saved" | "error";

/**
 * Progress glyph for the in-frame Update preview control.
 * Resting / error keep the viewfinder; capturing spins the shared
 * dashed ring; saved lands on a filled check (CON-36).
 */
export function CapturePreviewStatusIcon({
  status,
}: {
  status: CapturePreviewStatus;
}) {
  if (status === "capturing") {
    return <DottedSpinner size={14} className="shrink-0" />;
  }
  if (status === "saved") {
    return <CheckCircleFilled size={14} className="shrink-0" />;
  }
  return <FrameCorners size={14} strokeWidth={1.75} />;
}
