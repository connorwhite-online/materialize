"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X } from "@/components/icons/x";
import { deleteFilePhoto } from "@/app/actions/photos";

interface Props {
  photoId: string;
  /** Optional aria label override (e.g. "Delete photo"). */
  ariaLabel?: string;
}

/**
 * Corner-pinned X button that gates photo deletion behind a single
 * confirm dialog. Used on every photo in both the curator gallery
 * and the community photos feed when the viewer is allowed to
 * delete (owner of the photo or owner of the listing).
 *
 * The trigger sits absolute top-right of its parent — the parent
 * needs `position: relative` for it to land correctly. Click events
 * are stopped at the trigger so they don't bubble up to a parent
 * that's also clickable (e.g. a thumbnail that opens a lightbox).
 */
export function DeletePhotoButton({
  photoId,
  ariaLabel = "Delete photo",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleConfirm = () => {
    if (pending) return;
    startTransition(async () => {
      const res = await deleteFilePhoto(photoId);
      if ("error" in res) {
        // Surfacing the error inside the dialog isn't worth the
        // wiring for a delete-photo action that effectively never
        // fails; falling back silently is fine for v1.
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        // Dark-red glyph on a translucent red wash with a subtle
        // backdrop blur — the blur lifts the X off whatever's behind
        // it so it stays legible over busy photos. Pinned tight to
        // the corner of the parent rather than inset.
        className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-destructive/20 text-destructive ring-1 ring-destructive/30 backdrop-blur-md transition-colors hover:bg-destructive/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive cursor-pointer"
      >
        <X size={14} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this photo?</DialogTitle>
            <DialogDescription>
              This permanently removes the photo from this listing. It
              can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={pending}
            >
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
