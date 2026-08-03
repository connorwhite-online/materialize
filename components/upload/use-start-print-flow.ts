"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDraftFileForPrint } from "@/app/actions/files";
import { uploadFileToR2 } from "./upload-file-to-r2";

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

          // Presign + PUT to R2 with progress (shared helper — MONEY-3).
          const uploaded = await uploadFileToR2({
            file,
            kind: "authed-print",
            onProgress: setProgress,
          });
          if ("error" in uploaded) throw new Error(uploaded.error);
          const { storageKey, format: serverFormat } = uploaded;

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
