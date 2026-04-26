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
import { deleteProject } from "@/app/actions/projects";

interface DeleteProjectButtonProps {
  projectId: string;
  projectName: string;
  hasBuyers: boolean;
  buyerCount: number;
  redirectTo: string;
}

export function DeleteProjectButton({
  projectId,
  projectName,
  hasBuyers,
  buyerCount,
  redirectTo,
}: DeleteProjectButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = typed.trim() === projectName;

  const handleConfirm = () => {
    if (!matches || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteProject(projectId);
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
            Delete project
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {hasBuyers ? "Archive this project?" : "Delete this project?"}
          </DialogTitle>
          <DialogDescription>
            {hasBuyers ? (
              <>
                {buyerCount} {buyerCount === 1 ? "person has" : "people have"}{" "}
                purchased this project. We&apos;ll stop selling it and hide it,
                but their purchased copies stay downloadable. This
                can&apos;t be undone.
              </>
            ) : (
              <>
                This deletes the project bundle. The individual files inside
                stay in your library. This can&apos;t be undone.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="confirm-name" className="text-xs">
            Type{" "}
            <span className="font-mono font-medium text-foreground">
              {projectName}
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
