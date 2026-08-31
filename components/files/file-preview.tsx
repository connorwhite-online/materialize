"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { OrderModelPreviewLazy } from "@/components/print/order-model-preview-lazy";
import {
  capturePositionFor,
  type PreviewView,
} from "@/components/viewer/preview-camera";

// ThumbnailCapture mounts only while a capture is in flight. The
// detail viewer has already pulled three.js in by this point, but the
// capture rig is its own module — keep it out of the route chunk until
// an owner actually presses the button. (CON-139)
const ThumbnailCapture = lazy(() =>
  import("@/components/viewer/thumbnail-capture").then((m) => ({
    default: m.ThumbnailCapture,
  }))
);

type CaptureStatus = "idle" | "capturing" | "saved" | "error";

interface FilePreviewProps {
  fileId: string;
  fileAssetId: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
  materialColor: string;
  recommendedMaterialId?: string | null;
  /**
   * Whether to offer "Update preview" in the viewer frame. Decided on
   * the server from the file's owner; the write is independently
   * ownership-checked in `POST /api/thumbnails`, so this only governs
   * whether the affordance is shown.
   */
  canUpdatePreview?: boolean;
  /**
   * The angle this file's owner chose, if they ever pressed "Update
   * preview". The viewer opens on it instead of its head-on default —
   * the saved angle is the author's declared best view of the object,
   * so it should be the one everybody arrives at.
   */
  initialView?: PreviewView | null;
}

/**
 * The file-detail 3D preview, plus — for the owner — the ability to
 * re-shoot the file's snapshot from the angle they have orbited to.
 *
 * A file's thumbnail is otherwise shot once, automatically, head-on,
 * the first time the owner opens the page with no cached thumbnail
 * (`FileThumbnailGenerator`). That single frame then represents the
 * file everywhere: browse cards, library tiles, search results,
 * JSON-LD, and the OG card a link preview renders. For a part whose
 * interesting geometry faces away from that default camera, the
 * creator had no way to fix it.
 *
 * The capture is re-rendered offscreen rather than read off the live
 * canvas. The live canvas is 4:3 and carries UI chrome, and its
 * `<Canvas>` sets no `preserveDrawingBuffer`, so reading it back is
 * only valid inside a synchronous render. Re-shooting through the
 * existing `ThumbnailCapture` rig keeps every thumbnail in the product
 * square, identically lit, and normalized the same way — the creator
 * changes the angle, not the format.
 */
export function FilePreview({
  fileId,
  fileAssetId,
  format,
  materialColor,
  recommendedMaterialId,
  canUpdatePreview = false,
  initialView,
}: FilePreviewProps) {
  const router = useRouter();
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pendingView, setPendingView] = useState<PreviewView | null>(null);
  // Ref twin of pendingView so the capture callback cannot POST the
  // image without the angle — a stale closure here is how a thumbnail
  // can land with null preview_dir_* columns (CON-27 data gap).
  const pendingViewRef = useRef<PreviewView | null>(null);

  // Settle the button back to its resting label so a creator can shoot
  // again without wondering whether the control is still live. The
  // button is never disabled in the resolved states — this is only
  // about the label not lying about being current.
  useEffect(() => {
    if (status !== "saved" && status !== "error") return;
    const timer = setTimeout(() => {
      setStatus("idle");
      setMessage(null);
    }, 2500);
    return () => clearTimeout(timer);
  }, [status]);

  const onCapturePreview = useCallback((view: PreviewView) => {
    setStatus("capturing");
    setMessage(null);
    pendingViewRef.current = view;
    setPendingView(view);
  }, []);

  const onCaptured = useCallback(
    async (id: string, dataUrl: string) => {
      // Read before clearing — the state update below is what unmounts
      // the capture rig, and the view has to travel with the image.
      const view = pendingViewRef.current;
      pendingViewRef.current = null;
      setPendingView(null);
      try {
        const res = await fetch("/api/thumbnails", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
          fileId: id,
          dataUrl,
          // Sent with the image so the file remembers the angle it was
          // shot from, and can open on it. Required for Update preview:
          // without it the angled thumbnail survives and the viewer
          // still opens head-on.
          previewView: view
            ? { direction: view.direction, framing: view.framing }
            : undefined,
        }),
        });
        if (!res.ok) {
          const detail = await res.text();
          console.warn("[file-preview] POST failed", detail);
          let reason = "";
          try {
            reason = (JSON.parse(detail) as { error?: string }).error ?? "";
          } catch {
            // Non-JSON body (a proxy error page, say) — the status
            // line is all we can honestly report.
          }
          setMessage(
            reason
              ? `Couldn't save the preview: ${reason}`
              : `Couldn't save the preview (HTTP ${res.status})`
          );
          setStatus("error");
          return;
        }
        setMessage(null);
        setStatus("saved");
        // The thumbnail URL is stable (`/api/thumbnails/{fileId}`), so a
        // route refresh alone would re-render the same src against a
        // cached image. The GET route's own cache headers govern that;
        // refresh so any server-rendered consumer of the row updates.
        router.refresh();
      } catch (err) {
        console.warn("[file-preview] POST error", err);
        setMessage(
          err instanceof Error
            ? `Couldn't save the preview: ${err.message}`
            : "Couldn't save the preview — the upload didn't complete."
        );
        setStatus("error");
      }
    },
    [router]
  );

  return (
    <>
      <OrderModelPreviewLazy
        fileAssetId={fileAssetId}
        format={format}
        materialColor={materialColor}
        onCapturePreview={canUpdatePreview ? onCapturePreview : undefined}
        capturePreviewStatus={status}
        capturePreviewMessage={message}
        initialView={initialView}
      />
      {pendingView && (
        <Suspense fallback={null}>
          <ThumbnailCapture
            // Remount per capture: the rig applies its camera on mount,
            // and each press is a fresh shot.
            key={`${pendingView.direction.join(",")}:${pendingView.framing}`}
            modelUrl={`/api/files/preview/${fileAssetId}`}
            format={format}
            fileId={fileId}
            onCapture={onCaptured}
            recommendedMaterialId={recommendedMaterialId}
            cameraPosition={capturePositionFor(pendingView)}
          />
        </Suspense>
      )}
    </>
  );
}
