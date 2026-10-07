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
import { Field } from "@/components/ui/field";
import { deleteFileListing } from "@/app/actions/files";

interface DeleteFileButtonProps {
  fileId: string;
  fileName: string;
  hasBuyers: boolean;
  buyerCount: number;
  redirectTo: string;
  /**
   * Optional custom trigger element. Lets the call site swap in an
   * icon button or any other shape; defaults to an outline
   * button labeled "Delete file".
   */
  trigger?: React.ReactNode;
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
  trigger,
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
          trigger ? (
            (trigger as React.ReactElement)
          ) : (
            <Button variant="outline" className="text-destructive">
              Delete file
            </Button>
          )
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {hasBuyers ? "Archive this file?" : "Delete this file?"}
          </DialogTitle>
          <DialogDescription>
            {hasBuyers ? (
              <>
                This file is referenced by {buyerCount} existing{" "}
                {buyerCount === 1
                  ? "purchase, cart, or order"
                  : "purchases, carts, or orders"}
                . We&apos;ll stop selling it and hide it from your library, but
                those existing references keep working. This can&apos;t be
                undone.
              </>
            ) : (
              <>
                This will permanently delete the listing, every uploaded model
                file, and every part photo. This can&apos;t be undone.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            handleConfirm();
          }}
        >
          <Field
            label={
              <span>
                Type{" "}
                <span className="font-mono text-[13px] font-medium">
                  {fileName}
                </span>{" "}
                to confirm
              </span>
            }
            htmlFor="confirm-name"
            error={error ?? undefined}
          >
            <Input
              id="confirm-name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              loading={pending}
              disabled={!matches}
            >
              {hasBuyers ? "Archive permanently" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
