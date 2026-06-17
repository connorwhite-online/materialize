"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RichTextEditor, type Editor } from "@/components/ui/rich-text-editor";
import { EditorToolbar } from "@/components/ui/editor-toolbar";
import { ChevronLeft } from "@/components/icons/chevron-left";
import { updateProjectBuildGuide } from "@/app/actions/projects";
import { addProjectGuideImage } from "@/app/actions/project-photos";
import { uploadPhotoToR2, validatePhoto } from "@/lib/photos/upload-photo";
import { toEditorHtml, isEmptyHtml } from "@/lib/build-guide/seed";
import { MAX_BUILD_GUIDE_LENGTH } from "@/lib/validations/project";

const GUIDE_IMAGE_MAX_HEIGHT = "max-h-[36rem]";

interface Props {
  projectId: string;
  slug: string;
  projectName: string;
  buildGuide: string | null;
}

/**
 * Focused, full-page build-guide editor. Editing lives on its own route
 * (not inline on the project page) so authors get room to concentrate.
 * The formatting toolbar and Save control float in a sticky header; the
 * editable surface is a centered column. Leaving with unsaved changes
 * prompts a confirm.
 */
export function BuildGuideEditor({
  projectId,
  slug,
  projectName,
  buildGuide,
}: Props) {
  const router = useRouter();
  const seedHtml = useMemo(() => toEditorHtml(buildGuide), [buildGuide]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draft, setDraft] = useState(seedHtml);
  const [dirty, setDirty] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  // The fixed floating-toolbar wrapper. Its `bottom` is rewritten from
  // the VisualViewport API so the bar rides above the iOS soft keyboard
  // instead of hiding behind it (same pattern as HomeBottomBar).
  const toolbarWrapRef = useRef<HTMLDivElement>(null);

  const onChange = useCallback((html: string) => {
    setDraft(html);
    setDirty(true);
  }, []);

  // Warn before a hard navigation / tab close with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Pin the floating toolbar above the soft keyboard on mobile. Without
  // this the fixed bar sits at bottom-5 of the layout viewport, which on
  // iOS hides behind the keyboard once the editor is focused. Re-runs
  // when the editor mounts so the ref is populated. 20 = bottom-5.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    const updateOffset = () => {
      const el = toolbarWrapRef.current;
      if (!el) return;
      const overlap = window.innerHeight - vv.height - vv.offsetTop;
      el.style.bottom = `${Math.max(20, overlap + 20)}px`;
    };

    updateOffset();
    vv.addEventListener("resize", updateOffset);
    vv.addEventListener("scroll", updateOffset);
    return () => {
      vv.removeEventListener("resize", updateOffset);
      vv.removeEventListener("scroll", updateOffset);
    };
  }, [editor]);

  // In-app "Back": unsaved edits open our own confirm dialog instead of
  // window.confirm. (The beforeunload guard above only covers hard
  // navigations — refresh / tab close — which browsers won't let us skin.)
  const leave = () => {
    if (dirty) {
      setConfirmLeave(true);
      return;
    }
    router.push(`/projects/${slug}`);
  };

  const discardAndLeave = () => {
    // Drop the dirty flag first so the beforeunload listener detaches
    // before we navigate — no stray native prompt on the way out.
    setDirty(false);
    setConfirmLeave(false);
    router.push(`/projects/${slug}`);
  };

  const uploadImage = useCallback(
    async (file: File): Promise<string> => {
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
    },
    [projectId]
  );

  const uploadImages = useCallback(
    async (files: File[]): Promise<string[]> => {
      const out: string[] = [];
      for (const file of files) {
        out.push(await uploadImage(file));
      }
      return out;
    },
    [uploadImage]
  );

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
      setDirty(false);
      router.push(`/projects/${slug}`);
    });
  };

  const overLimit = draft.length > MAX_BUILD_GUIDE_LENGTH;

  return (
    <div className="min-h-screen">
      {/* Top bar: back · project title · save */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={leave}
            className="shrink-0"
          >
            <ChevronLeft size={16} />
            Back
          </Button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
            {projectName}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {uploading
                ? "Uploading…"
                : overLimit
                  ? `${draft.length.toLocaleString()} / ${MAX_BUILD_GUIDE_LENGTH.toLocaleString()}`
                  : null}
            </span>
            <Button
              type="button"
              size="sm"
              onClick={save}
              loading={pending}
              disabled={uploading || overLimit}
            >
              Save
            </Button>
          </div>
        </div>
      </header>

      {/* Extra bottom padding so the floating toolbar never covers the
          last lines of the guide when scrolled to the end. */}
      <main className="mx-auto max-w-3xl px-4 pb-32 pt-8">
        {error && (
          <p className="mb-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <RichTextEditor
          initialHTML={seedHtml}
          onChange={onChange}
          onEditorReady={setEditor}
          imageMaxHeightClass={GUIDE_IMAGE_MAX_HEIGHT}
          disabled={pending}
          placeholder={
            "Start with a heading for each chapter (they become collapsible sections), then write the steps. Paste a README, or use the toolbar to format, insert images, and add galleries."
          }
        />
      </main>

      {/* Floating formatting toolbar, centered just above the bottom edge.
          The full-width wrapper is click-through; only the pill itself
          captures pointer events so it never blocks the page behind it.
          `nav:pl-56` mirrors the app shell's sidebar gutter so the pill
          centers over the guide column, not the whole viewport. */}
      {editor && (
        <div
          ref={toolbarWrapRef}
          className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4 nav:pl-56"
        >
          <div className="pointer-events-auto max-w-full overflow-x-auto rounded-xl border border-border bg-card p-1.5 shadow-lg">
            <EditorToolbar
              editor={editor}
              onUploadImage={uploadImage}
              onUploadImages={uploadImages}
              disabled={pending}
            />
          </div>
        </div>
      )}

      {/* Custom discard confirmation — replaces window.confirm on Back. */}
      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              You have edits to this build guide that haven&apos;t been saved.
              Leaving now will lose them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmLeave(false)}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={discardAndLeave}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
