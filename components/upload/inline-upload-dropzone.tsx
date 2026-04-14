"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { FileUploader } from "./file-uploader";
import { useStartPrintFlow } from "./use-start-print-flow";
import { useAuthModal } from "@/components/auth/auth-modal";

type PickedFile = {
  file: File;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
};

/**
 * Drop zone used on the `/print` page. The whole page is about
 * printing, so the intent is unambiguous — as soon as a file is
 * picked we fire the full Print flow (R2 upload → draft file row
 * → redirect to the quote configurator) via the shared
 * useStartPrintFlow hook.
 *
 * Anon users are bounced to the auth modal first; their picked
 * file stays in state and the print flow auto-resumes as soon as
 * they authenticate.
 */
export function InlineUploadDropzone() {
  const { isSignedIn, isLoaded } = useUser();
  const { openAuth } = useAuthModal();
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const { start, phase, progress, error } = useStartPrintFlow();
  const started = useRef(false);

  const handleFilePicked = (
    file: File,
    format: "stl" | "obj" | "3mf" | "step" | "amf"
  ) => {
    started.current = false;
    setPicked({ file, format });
  };

  // Kick off the print flow whenever we have a picked file AND a
  // signed-in user. For signed-out users we open the auth modal
  // and wait — the moment they come back authenticated, this
  // effect re-runs and starts the upload automatically.
  useEffect(() => {
    if (!picked || !isLoaded) return;
    if (started.current) return;

    if (!isSignedIn) {
      openAuth("sign-up");
      return;
    }

    started.current = true;
    start(picked.file, picked.format);
  }, [picked, isSignedIn, isLoaded, start, openAuth]);

  // While the user is uploading / navigating we show a status line
  // instead of the dropzone. Reduces visual jitter.
  if (picked && (phase === "uploading" || phase === "saving")) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        <p className="mt-3 text-sm font-medium">
          {phase === "uploading"
            ? `Uploading ${picked.file.name} — ${progress}%`
            : "Preparing quote configurator…"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {phase === "uploading"
            ? "We'll drop you into the material picker the moment this finishes."
            : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <FileUploader onFileSelected={handleFilePicked} />
      {picked && !isSignedIn && (
        <p className="text-xs text-muted-foreground">
          Sign up to continue — your file is ready to go.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
