"use client";

import { useRef, useState, useTransition } from "react";
import { updateAvatar, removeAvatar } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/auth/user-avatar";

interface AvatarUploaderProps {
  /** Seed for the gradient fallback — username or user id. */
  seed: string;
  displayName: string;
  initialAvatarUrl: string | null;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

/**
 * Avatar control for the settings Profile card. Shows the current
 * avatar (or gradient fallback) with Upload / Change + Remove buttons.
 * Uploads run through the `updateAvatar` server action, which pushes the
 * image to Clerk and mirrors the resulting URL back into our DB; we
 * optimistically swap in a local object URL while that round-trips.
 */
export function AvatarUploader({
  seed,
  displayName,
  initialAvatarUrl,
}: AvatarUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleFile = (file: File) => {
    setError(null);
    // Local preview so the new image appears instantly; revoked once
    // the action resolves (success swaps in the real URL, failure
    // reverts).
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    const formData = new FormData();
    formData.set("avatar", file);

    startTransition(async () => {
      const result = await updateAvatar(formData);
      URL.revokeObjectURL(objectUrl);
      setPreviewUrl(null);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setAvatarUrl(result.avatarUrl);
    });
  };

  const handleRemove = () => {
    setError(null);
    startTransition(async () => {
      const result = await removeAvatar();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setAvatarUrl(null);
    });
  };

  const shown = previewUrl ?? avatarUrl;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <UserAvatar
          seed={seed}
          imageUrl={shown}
          displayName={displayName}
          className="h-16 w-16"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              // Reset so picking the same file again re-triggers change.
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
          >
            {pending
              ? "Uploading…"
              : avatarUrl
                ? "Change photo"
                : "Upload photo"}
          </Button>
          {avatarUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={handleRemove}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        JPG, PNG, WEBP or GIF, up to 10MB.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
