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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "@/components/icons/plus";
import { addFilesToProject } from "@/app/actions/projects";

interface AvailableFile {
  id: string;
  name: string;
  thumbnailUrl: string | null;
}

interface Props {
  projectId: string;
  /**
   * The viewer's files that aren't already bundled in this project.
   * Computed server-side on the project page so the picker only
   * offers attachable, not-yet-attached files.
   */
  availableFiles: AvailableFile[];
}

/**
 * Owner-only dialog to bundle more of the viewer's existing files
 * into a project after creation. Mirrors the file picker on the
 * create form, but calls addFilesToProject (which dedupes + caps at
 * MAX_PROJECT_FILES server-side) instead of createProject.
 */
export function AddProjectFilesDialog({ projectId, availableFiles }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const handleSubmit = () => {
    if (selected.length === 0) {
      setError("Pick at least one file.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addFilesToProject(projectId, selected);
      if (res && "error" in res) {
        setError(res.error ?? "Failed to add files.");
        return;
      }
      setSelected([]);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSelected([]);
          setError(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Plus size={14} />
            Add files
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] w-full max-w-lg overflow-y-auto sm:max-w-lg">
        <DialogHeader className="min-w-0">
          <DialogTitle>Add files to this project</DialogTitle>
          <DialogDescription>
            Bundle more of your files into this project. Buyers get every
            file in the bundle.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0">
          {availableFiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              All of your files are already in this project. Upload more
              files first to add them here.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {availableFiles.map((f) => {
                const isSelected = selected.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggle(f.id)}
                    aria-pressed={isSelected}
                    className={`relative aspect-square overflow-hidden rounded-lg border text-left transition-colors ${
                      isSelected
                        ? "border-primary ring-2 ring-primary/40"
                        : "border-border hover:border-primary/30"
                    }`}
                  >
                    {f.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={f.thumbnailUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-muted text-[10px] text-muted-foreground/60">
                        No preview
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 text-[10px] text-white line-clamp-1">
                      {f.name}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={pending || selected.length === 0}
          >
            {pending
              ? "Adding…"
              : selected.length > 0
                ? `Add ${selected.length} ${selected.length === 1 ? "file" : "files"}`
                : "Add files"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
