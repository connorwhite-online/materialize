"use client";

import { useState, useRef, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ImagePlus } from "@/components/icons/image-plus";
import { X } from "@/components/icons/x";
import { postComment, type CommentTarget } from "@/app/actions/comments";
import { addFileMake } from "@/app/actions/photos";
import {
  uploadPhotoToR2,
  validatePhoto,
} from "@/lib/photos/upload-photo";
import { MAX_COMMENT_LENGTH } from "@/lib/validations/comment";
import { cn } from "@/lib/utils";

interface Props {
  target: CommentTarget;
  targetId: string;
  parentId?: string;
  /** Called when post succeeds — used by reply forms to collapse. */
  onPosted?: () => void;
  /** Called when user clicks Cancel on a reply form. */
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  /**
   * Allow attaching a single photo. Top-level posts on file detail
   * only — projects don't carry photo posts, and reply forms don't
   * either.
   */
  acceptPhoto?: boolean;
  /**
   * The fileId — required when `acceptPhoto` is on, since posting a
   * photo routes through addFileMake which writes to filePhotos
   * for this listing.
   */
  fileId?: string;
}

/**
 * Inline composer for both top-level posts and replies. On the file
 * detail page it doubles as a photo composer: with `acceptPhoto`
 * on, the user can pick (or drag, or paste) one image; the textarea
 * becomes its caption. Posting takes one of two paths:
 *
 *   - photo attached → upload to R2, addFileMake({fileId, storageKey,
 *     caption: trimmedBody || undefined}). Renders as a photo post
 *     interleaved into the comment thread.
 *   - text only → postComment(target, targetId, {body, parentId}) —
 *     existing behavior.
 *
 * Submission re-renders the page via `router.refresh()` to surface
 * the new row through Next's normal data fetching.
 */
export function CommentForm({
  target,
  targetId,
  parentId,
  onPosted,
  onCancel,
  placeholder = "Share your thoughts…",
  autoFocus = false,
  acceptPhoto = false,
  fileId,
}: Props) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Object URLs need to be revoked when they're replaced or when the
  // component unmounts to avoid leaking blobs.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const attachFile = (file: File) => {
    const invalid = validatePhoto(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setAttachedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const clearAttachment = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setAttachedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = () => {
    if (pending) return;
    const trimmed = body.trim();
    // Empty post — neither text nor photo.
    if (!trimmed && !attachedFile) return;
    setError(null);
    startTransition(async () => {
      try {
        if (attachedFile && acceptPhoto && fileId) {
          const { storageKey } = await uploadPhotoToR2(attachedFile);
          const res = await addFileMake({
            fileId,
            storageKey,
            caption: trimmed || undefined,
          });
          if (res && "error" in res) {
            setError(res.error ?? "Couldn't post photo.");
            return;
          }
        } else {
          const res = await postComment(target, targetId, {
            body: trimmed,
            parentId,
          });
          if ("error" in res) {
            setError(res.error);
            return;
          }
        }
        setBody("");
        clearAttachment();
        onPosted?.();
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't post."
        );
      }
    });
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!acceptPhoto || attachedFile) return;
    for (const item of e.clipboardData.items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) {
          e.preventDefault();
          attachFile(f);
          return;
        }
      }
    }
  };

  const placeholderText = acceptPhoto
    ? attachedFile
      ? "Add a caption (optional)…"
      : "Share thoughts, or drop a photo of your print…"
    : placeholder;

  const canSubmit = !pending && (body.trim().length > 0 || !!attachedFile);
  const submitLabel = pending
    ? "Posting…"
    : parentId
      ? "Reply"
      : attachedFile
        ? "Post photo"
        : "Post";

  return (
    <div className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onPaste={handlePaste}
        placeholder={placeholderText}
        maxLength={MAX_COMMENT_LENGTH}
        autoFocus={autoFocus}
        className="min-h-20"
        onKeyDown={(e) => {
          // Cmd/Ctrl-Enter submits — common pattern for any inline
          // composer, lets keyboard users post without reaching for
          // the mouse.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />

      {previewUrl && (
        <div className="relative inline-block overflow-hidden rounded-lg border border-border">
          <img
            src={previewUrl}
            alt="Attached photo preview"
            className="block max-h-32 max-w-full object-contain"
          />
          <button
            type="button"
            onClick={clearAttachment}
            aria-label="Remove attached photo"
            className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-destructive/20 text-destructive ring-1 ring-destructive/30 backdrop-blur-md transition-colors hover:bg-destructive/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        {acceptPhoto && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) attachFile(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending}
              aria-label="Attach photo"
              title="Attach a photo"
              className={cn(
                "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "mr-auto",
                attachedFile && "text-foreground"
              )}
            >
              <ImagePlus size={18} />
            </button>
          </>
        )}
        {onCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
        )}
        <Button size="sm" onClick={submit} disabled={!canSubmit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
