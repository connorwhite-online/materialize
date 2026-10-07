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
import { deleteProject } from "@/app/actions/projects";

interface DeleteProjectButtonProps {
  projectId: string;
  projectName: string;
  hasBuyers: boolean;
  buyerCount: number;
  redirectTo: string;
  /**
   * Optional custom trigger element. Lets the call site swap in an
   * icon button or any other shape; defaults to an outline
   * button labeled "Delete project".
   */
  trigger?: React.ReactNode;
}

export function DeleteProjectButton({
  projectId,
  projectName,
  hasBuyers,
  buyerCount,
  redirectTo,
  trigger,
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
          trigger ? (
            (trigger as React.ReactElement)
          ) : (
            <Button variant="outline" className="text-destructive">
              Delete project
            </Button>
          )
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {hasBuyers ? "Archive this project?" : "Delete this project?"}
          </DialogTitle>
          <DialogDescription>
            {hasBuyers ? (
              <>
                {buyerCount} {buyerCount === 1 ? "person has" : "people have"}{" "}
                purchased this project. We&apos;ll stop selling it and hide it,
                but their purchased copies stay downloadable. This can&apos;t be
                undone.
              </>
            ) : (
              <>
                This deletes the project bundle. The individual files inside
                stay in your library. This can&apos;t be undone.
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
                  {projectName}
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
