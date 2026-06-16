"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { marked } from "marked";
import { Button } from "@/components/ui/button";
import { MarkdownProse } from "@/components/ui/markdown-prose";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
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

// Stored guides predate the WYSIWYG editor and hold markdown. Detect
// that case so we can convert markdown → HTML once, when the editor is
// first opened on a legacy guide. New guides are saved as HTML and skip
// the conversion (they already contain block tags).
function looksLikeHtml(content: string): boolean {
  return /<(p|div|h[1-6]|ul|ol|li|img|br|blockquote|pre|table|strong|em|a)\b/i.test(
    content
  );
}

function toEditorHtml(content: string | null): string {
  if (!content) return "";
  if (looksLikeHtml(content)) return content;
  // marked passes embedded HTML through and renders markdown to HTML.
  return marked.parse(content, { async: false }) as string;
}

// Tiptap emits `<p></p>` for an empty document. Treat a guide as empty
// when it has no text and no standalone media so we store NULL rather
// than an empty paragraph.
function isEmptyHtml(html: string): boolean {
  if (/<(img|hr)\b/i.test(html)) return false;
  return (
    html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim().length === 0
  );
}

/**
 * Renders a project's build guide and — for users with write access —
 * an inline WYSIWYG editor with image upload.
 *
 * The guide is stored as sanitized HTML. The editor (Tiptap) reads and
 * writes HTML, so pasting a README's formatted HTML round-trips, and
 * non-technical authors get rich text without typing markup. Inserted
 * images upload to R2, register as `kind = 'inline'` project photos, and
 * are referenced by the `/api/thumbnails/projects/{id}?photoId=` proxy
 * URL so the link resolves to a freshly-signed URL on every load.
 */
export function BuildGuide({ projectId, buildGuide, canManage }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();

  // Seed value for the editor, computed from the persisted guide. Recomputed
  // only when the source changes; the editor reads it once on mount.
  const seedHtml = useMemo(() => toEditorHtml(buildGuide), [buildGuide]);

  const startEditing = () => {
    setDraft(seedHtml);
    setError(null);
    setEditing(true);
  };

  const uploadImage = async (file: File): Promise<string> => {
    const invalid = validatePhoto(file);
    if (invalid) {
      setError(invalid);
      throw new Error(invalid);
    }
    setError(null);
    setUploading(true);
    try {
      const { storageKey } = await uploadPhotoToR2(file);
      const res = await addProjectGuideImage({ projectId, storageKey });
      if ("error" in res) {
        const msg = res.error ?? "Couldn't upload image.";
        setError(msg);
        throw new Error(msg);
      }
      return `/api/thumbnails/projects/${projectId}?photoId=${res.photoId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload image.");
      throw err;
    } finally {
      setUploading(false);
    }
  };

  const save = () => {
    const payload = isEmptyHtml(draft) ? "" : draft;
    if (payload.length > MAX_BUILD_GUIDE_LENGTH) {
      setError(
        `Build guide is too long (${payload.length.toLocaleString()} / ${MAX_BUILD_GUIDE_LENGTH.toLocaleString()} characters).`
      );
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await updateProjectBuildGuide(projectId, payload);
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
          <MarkdownProse imageMaxHeightClass={GUIDE_IMAGE_MAX_HEIGHT} allowHtml>
            {buildGuide}
          </MarkdownProse>
        ) : (
          canManage && (
            <p className="text-sm text-muted-foreground">
              Document how to build this project — steps, photos, wiring
              notes, code snippets. Paste in a README or write it inline with
              rich text and images.
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
  const busy = pending || uploading;
  return (
    <div className="space-y-2">
      <RichTextEditor
        initialHTML={seedHtml}
        onChange={setDraft}
        onUploadImage={uploadImage}
        imageMaxHeightClass={GUIDE_IMAGE_MAX_HEIGHT}
        disabled={pending}
        placeholder={
          "Step 1 — Print the parts. Use PLA at 0.2mm…\n\nPaste a README, or use the toolbar to format and insert images."
        }
      />

      <div className="flex items-center justify-between">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {uploading ? "Uploading image…" : null}
          {!uploading && draft.length > MAX_BUILD_GUIDE_LENGTH * 0.9
            ? `${draft.length.toLocaleString()} / ${MAX_BUILD_GUIDE_LENGTH.toLocaleString()}`
            : null}
        </span>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
