"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownProse } from "@/components/ui/markdown-prose";
import { ImagePlus } from "@/components/icons/image-plus";
import { updateProjectBuildGuide } from "@/app/actions/projects";
import { addProjectGuideImage } from "@/app/actions/project-photos";
import { uploadPhotoToR2, validatePhoto } from "@/lib/photos/upload-photo";
import { MAX_BUILD_GUIDE_LENGTH } from "@/lib/validations/project";

interface Props {
  projectId: string;
  buildGuide: string | null;
  /**
   * Whether to surface the inline editor. The project page passes
   * `isOwner` (the creator or an org member) — matching its other
   * owner-only controls (EditProjectDialog, EditBomDialog). Collaborators
   * are authorized server-side by `updateProjectBuildGuide` /
   * `addProjectGuideImage` (both via `canWriteProject`) but the page
   * doesn't render the editor for them yet.
   */
  canManage: boolean;
}

// Step photos in a guide want to read larger than the compact cap used
// for descriptions and comment images.
const GUIDE_IMAGE_MAX_HEIGHT = "max-h-[36rem]";

/**
 * Renders a project's build guide and — for users with write access —
 * an inline markdown editor with image upload and a live preview.
 *
 * Images upload to R2 then register as `kind = 'inline'` project
 * photos; the editor splices the `/api/thumbnails/projects/{id}?photoId=`
 * proxy URL into the markdown so the reference resolves to a freshly-
 * signed link on every load (no expiry, same pattern as comment photos).
 */
export function BuildGuide({ projectId, buildGuide, canManage }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(buildGuide ?? "");
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startEditing = () => {
    setDraft(buildGuide ?? "");
    setError(null);
    setShowPreview(false);
    setEditing(true);
  };

  const insertAtCursor = (snippet: string) => {
    const el = textareaRef.current;
    if (!el) {
      setDraft((d) => (d ? `${d}\n\n${snippet}` : snippet));
      return;
    }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + snippet + draft.slice(end);
    setDraft(next);
    // Restore the caret just after the inserted snippet on the next tick.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleImage = async (file: File) => {
    const invalid = validatePhoto(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const { storageKey } = await uploadPhotoToR2(file);
      const res = await addProjectGuideImage({ projectId, storageKey });
      if ("error" in res) {
        setError(res.error ?? "Couldn't upload image.");
        return;
      }
      const url = `/api/thumbnails/projects/${projectId}?photoId=${res.photoId}`;
      insertAtCursor(`\n\n![](${url})\n\n`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload image.");
    } finally {
      setUploading(false);
    }
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateProjectBuildGuide(projectId, draft);
      if (res && "error" in res) {
        setError(res.error ?? "Couldn't save.");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  // ── Read-only view ──────────────────────────────────────────────
  if (!editing) {
    return (
      <div className="space-y-3">
        {buildGuide ? (
          <MarkdownProse imageMaxHeightClass={GUIDE_IMAGE_MAX_HEIGHT}>
            {buildGuide}
          </MarkdownProse>
        ) : (
          canManage && (
            <p className="text-sm text-muted-foreground">
              Document how to build this project — steps, photos, wiring
              notes, code snippets. Supports markdown and inline images.
            </p>
          )
        )}
        {canManage && (
          <Button variant="outline" size="sm" onClick={startEditing}>
            {buildGuide ? "Edit build guide" : "Write build guide"}
          </Button>
        )}
      </div>
    );
  }

  // ── Editor ──────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImage(f);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading || pending}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus size={14} />
            {uploading ? "Uploading…" : "Insert image"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? "Write" : "Preview"}
          </Button>
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {draft.length.toLocaleString()} / {MAX_BUILD_GUIDE_LENGTH.toLocaleString()}
        </span>
      </div>

      {showPreview ? (
        <div className="min-h-40 rounded-lg border border-border p-3">
          {draft.trim() ? (
            <MarkdownProse imageMaxHeightClass={GUIDE_IMAGE_MAX_HEIGHT}>
              {draft}
            </MarkdownProse>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
          )}
        </div>
      ) : (
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_BUILD_GUIDE_LENGTH}
          rows={16}
          placeholder={
            "## Step 1 — Print the parts\n\nUse PLA at 0.2mm…\n\n![](paste or insert an image)\n\n## Step 2 — Wiring\n\n…"
          }
          className="font-mono text-xs"
        />
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending || uploading}
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={pending || uploading} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
