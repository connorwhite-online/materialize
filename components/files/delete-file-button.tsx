"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteFileListing } from "@/app/actions/files";

interface DeleteFileButtonProps {
  fileId: string;
  fileName: string;
  hasBuyers: boolean;
  buyerCount: number;
  redirectTo: string;
}

/**
 * Two-stage confirmation:
 * 1. Click the destructive button → opens a dialog explaining the
 *    consequences. The exact copy depends on whether anyone has
 *    purchased the file (soft delete vs. hard delete).
 * 2. The user must type the file's exact name into the input before
 *    the final destructive button enables. Only then does the action
 *    fire.
 */
export function DeleteFileButton({
  fileId,
  fileName,
  hasBuyers,
  buyerCount,
  redirectTo,
}: DeleteFileButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = typed.trim() === fileName;

  const handleConfirm = () => {
    if (!matches || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteFileListing(fileId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.push(redirectTo);
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setTyped("");
          setError(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" className="w-full text-destructive">
            Delete file
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {hasBuyers ? "Archive this file?" : "Delete this file?"}
          </DialogTitle>
          <DialogDescription>
            {hasBuyers ? (
              <>
                This file is referenced by {buyerCount} existing{" "}
                {buyerCount === 1 ? "purchase, cart, or order" : "purchases, carts, or orders"}.
                We&apos;ll stop selling it and hide it from your library,
                but those existing references keep working. This
                can&apos;t be undone.
              </>
            ) : (
              <>
                This will permanently delete the listing, every uploaded
                model file, and every part photo. This can&apos;t be undone.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="confirm-name" className="text-xs">
            Type{" "}
            <span className="font-mono font-medium text-foreground">
              {fileName}
            </span>{" "}
            to confirm
          </Label>
          <Input
            id="confirm-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

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
            disabled={!matches || pending}
          >
            {pending
              ? hasBuyers
                ? "Archiving…"
                : "Deleting…"
              : hasBuyers
                ? "Archive permanently"
                : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
