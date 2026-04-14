"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useAuthModal } from "@/components/auth/auth-modal";
import { useStartPrintFlow } from "./use-start-print-flow";
import { XIcon } from "lucide-react";

export interface PickedFile {
  file: File;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
}

interface PickedFileActionsProps {
  picked: PickedFile;
  onUnpick: () => void;
  /**
   * Fires when the user clicks "Save to library". The parent handles
   * opening whatever dialog it uses (the home bar mounts a
   * FileMetadataForm inside its own Dialog).
   */
  onSave: () => void;
  primaryAction?: "print" | "save";
}

/**
 * Split-CTA UI rendered after the user has picked a file. File info
 * bar with an un-pick button, then two CTAs — "Print this file"
 * (primary, goes through the shared useStartPrintFlow hook) and
 * "Save to your library" (secondary, opens the listing metadata
 * form via the parent).
 *
 * Anon users who click either CTA are bounced to the auth modal.
 * When they come back signed-in, the intent they clicked last is
 * replayed automatically.
 */
export function PickedFileActions({
  picked,
  onUnpick,
  onSave,
  primaryAction = "print",
}: PickedFileActionsProps) {
  const { isSignedIn, isLoaded } = useUser();
  const { openAuth } = useAuthModal();
  const { start, phase, progress, error, isPending } = useStartPrintFlow();

  // If the user clicks a CTA while signed out, remember which one
  // they wanted so we can replay it the moment they authenticate.
  const [pendingIntent, setPendingIntent] = useState<
    "print" | "save" | null
  >(null);
  const lastAuthed = useRef(isSignedIn);
  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn && !lastAuthed.current && pendingIntent) {
      if (pendingIntent === "print") start(picked.file, picked.format);
      if (pendingIntent === "save") onSave();
      setPendingIntent(null);
    }
    lastAuthed.current = !!isSignedIn;
  }, [isSignedIn, isLoaded, pendingIntent, start, picked, onSave]);

  const handlePrint = () => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setPendingIntent("print");
      openAuth("sign-up");
      return;
    }
    start(picked.file, picked.format);
  };

  const handleSave = () => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setPendingIntent("save");
      openAuth("sign-up");
      return;
    }
    onSave();
  };

  const busy = isPending || phase !== "idle";

  return (
    <div className="space-y-3">
      {/* File info bar */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{picked.file.name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {formatSize(picked.file.size)} · .{picked.format}
          </p>
        </div>
        <button
          type="button"
          onClick={onUnpick}
          disabled={busy}
          aria-label="Remove file"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <ActionCard
          title="Print this file"
          description="Get instant quotes from manufacturers worldwide."
          primary={primaryAction === "print"}
          loadingLabel={
            phase === "uploading"
              ? `Uploading… ${progress}%`
              : phase === "saving"
                ? "Preparing…"
                : null
          }
          onClick={handlePrint}
          disabled={busy}
        />
        <ActionCard
          title="Save to your library"
          description="List it for sale, free download, or keep it private."
          primary={primaryAction === "save"}
          onClick={handleSave}
          disabled={busy}
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ActionCard({
  title,
  description,
  primary,
  loadingLabel,
  onClick,
  disabled,
}: {
  title: string;
  description: string;
  primary: boolean;
  loadingLabel?: string | null;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
        primary
          ? "depth-raised-on-dark border-transparent bg-primary text-primary-foreground hover:brightness-[0.95]"
          : "depth-raised border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted/40"
      }`}
    >
      <p className="text-sm font-semibold">
        {loadingLabel ?? title}
      </p>
      <p
        className={`text-[11px] leading-snug ${
          primary ? "text-primary-foreground/80" : "text-muted-foreground"
        }`}
      >
        {description}
      </p>
    </button>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
