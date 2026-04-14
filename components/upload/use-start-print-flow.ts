"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDraftFileForPrint } from "@/app/actions/files";

export type PrintFlowPhase = "idle" | "uploading" | "saving";

export interface StartPrintFlowResult {
  start: (file: File, format: "stl" | "obj" | "3mf" | "step" | "amf") => void;
  phase: PrintFlowPhase;
  progress: number;
  error: string | null;
  isPending: boolean;
}

/**
 * Shared upload → draft → navigate helper for the "Print this file"
 * CTA. Handles the R2 presign + PUT with progress, calls the
 * createDraftFileForPrint server action, and navigates to
 * /print/[newAssetId] on success. Exposes progress + phase + error
 * so callers can render their own UI around it.
 *
 * Used by both PickedFileActions (home bottom bar) and the /print
 * page's PrintPageContent so the R2 upload flow lives in one place.
 */
export function useStartPrintFlow(): StartPrintFlowResult {
  const router = useRouter();
  const [phase, setPhase] = useState<PrintFlowPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const start = useCallback(
    (file: File, format: "stl" | "obj" | "3mf" | "step" | "amf") => {
      setError(null);
      startTransition(async () => {
        try {
          setPhase("uploading");
          setProgress(0);

          const presignRes = await fetch("/api/upload/presign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              contentType: "application/octet-stream",
              fileSize: file.size,
            }),
          });
          if (!presignRes.ok) {
            const data = await presignRes.json().catch(() => ({}));
            throw new Error(
              data.error || `Presign failed (${presignRes.status})`
            );
          }
          const { uploadUrl, storageKey, format: serverFormat } =
            (await presignRes.json()) as {
              uploadUrl: string;
              storageKey: string;
              format: typeof format;
            };

          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.upload.addEventListener("progress", (ev) => {
              if (ev.lengthComputable) {
                setProgress(Math.round((ev.loaded / ev.total) * 100));
              }
            });
            xhr.addEventListener("load", () => {
              if (xhr.status >= 200 && xhr.status < 300) resolve();
              else reject(new Error(`R2 upload failed (${xhr.status})`));
            });
            xhr.addEventListener("error", () =>
              reject(new Error("Network error uploading to R2."))
            );
            xhr.open("PUT", uploadUrl);
            xhr.setRequestHeader("Content-Type", "application/octet-stream");
            xhr.send(file);
          });

          setPhase("saving");
          const result = await createDraftFileForPrint({
            storageKey,
            originalFilename: file.name,
            format: serverFormat,
            fileSize: file.size,
          });

          if ("error" in result) {
            setError(result.error);
            setPhase("idle");
            return;
          }

          router.push(`/print/${result.fileAssetId}`);
          // Leave phase in "saving" — the navigation unmounts us.
        } catch (err) {
          setError(err instanceof Error ? err.message : "Upload failed");
          setPhase("idle");
        }
      });
    },
    [router]
  );

  return { start, phase, progress, error, isPending };
}
