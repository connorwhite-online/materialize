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
import { deleteProjectCircuit } from "@/app/actions/circuits";

interface Props {
  circuitId: string;
}

/**
 * Corner-X delete affordance for a circuit diagram tile. Same chrome
 * as `DeletePhotoButton` so the photo and circuit galleries feel
 * uniform — backdrop-blurred red wash, pinned top-right of the
 * parent's relative box.
 */
export function DeleteCircuitButton({ circuitId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleConfirm = () => {
    if (pending) return;
    startTransition(async () => {
      const res = await deleteProjectCircuit(circuitId);
      if ("error" in res) return;
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        aria-label="Delete diagram"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-destructive/20 text-destructive ring-1 ring-destructive/30 backdrop-blur-md transition-colors hover:bg-destructive/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive cursor-pointer"
      >
        <X size={14} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this diagram?</DialogTitle>
            <DialogDescription>
              This permanently removes the wiring diagram from the project.
              It can&apos;t be undone.
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
