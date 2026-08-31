"use client";

import { useState, useTransition, type ReactElement } from "react";
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
import { FileUploader } from "@/components/upload/file-uploader";
import { FileMetadataForm } from "@/components/upload/file-metadata-form";
import { addFilesToProject } from "@/app/actions/projects";
import { FileCard } from "@/components/files/file-card";

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
  /**
   * Optional custom trigger. Lets empty-state wells replace the
   * default outline "Add files" button without forking the dialog.
   */
  trigger?: ReactElement;
}

type PickedFile = {
  file: File;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
};

/**
 * Owner-only combo modal for growing a project's file bundle. Two
 * paths in one dialog:
 *   - Upload a brand-new file via the drop area up top — it routes
 *     through the standard metadata form (with the Project picker
 *     pre-set to this project) and createFileListing attaches it +
 *     redirects back here.
 *   - Pick from a horizontal carousel of the viewer's existing files
 *     that aren't in this project yet, then addFilesToProject (which
 *     dedupes + caps at MAX_PROJECT_FILES server-side).
 */
export function AddProjectFilesDialog({
  projectId,
  availableFiles,
  trigger,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // When set, the dialog swaps the picker for the upload metadata form.
  const [picked, setPicked] = useState<PickedFile | null>(null);

  const resetState = () => {
    setSelected([]);
    setError(null);
    setPicked(null);
  };

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const handleAdd = () => {
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
      resetState();
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetState();
      }}
    >
      <DialogTrigger
        render={
          trigger ?? (
            <Button variant="outline" size="sm">
              <Plus size={14} />
              Add files
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[90vh] w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
        {picked ? (
          <>
            <DialogHeader className="min-w-0">
              <DialogTitle>New file for this project</DialogTitle>
              <DialogDescription>
                Saving adds this file to the project automatically.
              </DialogDescription>
            </DialogHeader>
            <FileMetadataForm
              file={picked.file}
              format={picked.format}
              initialProjectId={projectId}
              onCancel={() => setPicked(null)}
            />
          </>
        ) : (
          <>
            <DialogHeader className="min-w-0">
              <DialogTitle>Add files to this project</DialogTitle>
              <DialogDescription>
                Upload a new file or pick from your library — buyers get
                every file in the bundle.
              </DialogDescription>
            </DialogHeader>

            <FileUploader
              onFileSelected={(file, format) => setPicked({ file, format })}
            />

            <div className="min-w-0 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {availableFiles.length > 0
                  ? "Or add from your library"
                  : "Your library"}
              </p>
              {availableFiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No other files to add yet — upload one above.
                </p>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {availableFiles.map((f) => (
                    <FileCard
                      key={f.id}
                      compact
                      title={f.name}
                      thumbnailUrl={f.thumbnailUrl}
                      placeholder="No preview"
                      selected={selected.includes(f.id)}
                      onClick={() => toggle(f.id)}
                    />
                  ))}
                </div>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
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
                onClick={handleAdd}
                disabled={pending || selected.length === 0}
              >
                {pending
                  ? "Adding…"
                  : selected.length > 0
                    ? `Add ${selected.length} ${selected.length === 1 ? "file" : "files"}`
                    : "Add files"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
