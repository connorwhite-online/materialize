"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateProject } from "@/app/actions/projects";

interface Props {
  projectId: string;
  initial: {
    name: string;
    description: string | null;
    tags: string[] | null;
    repoUrl: string | null;
    coverPhotoId: string | null;
    /**
     * Curator photos that are eligible to be picked as the cover.
     * The form omits the picker entirely when this list is empty —
     * a project with no curator photos can only fall back to the
     * legacy thumbnail.
     */
    photos: Array<{ id: string; downloadUrl: string }>;
  };
}

/**
 * Owner-only dialog for project metadata that doesn't fit elsewhere —
 * name, description, tags, and the optional code-repo URL. Lives on
 * the project sidebar alongside the BOM editor. Other fields (price,
 * license, visibility) intentionally aren't here because they're
 * decided at create time and changing them after-the-fact has buyer-
 * facing consequences that need their own UX.
 */
export function EditProjectDialog({ projectId, initial }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);
  // Empty string = auto thumbnail (no override); otherwise the selected
  // curator photo's id. Mirrors edit-file-button.tsx.
  const [coverPhotoId, setCoverPhotoId] = useState<string>(
    initial.coverPhotoId ?? ""
  );

  const handleSubmit = (formData: FormData) => {
    setErrors(null);
    // Always include the cover field so the server action knows the
    // user actually opened the dialog and made a decision (empty
    // string clears, populated string picks).
    formData.set("coverPhotoId", coverPhotoId);
    startTransition(async () => {
      const res = await updateProject(projectId, formData);
      if (res && "error" in res) {
        setErrors((res.error ?? null) as Record<string, string[]> | null);
        return;
      }
      router.refresh();
      setOpen(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" className="w-full">
            Edit details
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit project details</DialogTitle>
          <DialogDescription>
            Update the description, tags, or link a code repository for
            builders to clone.
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="edit-project-name">Name</Label>
            <Input
              id="edit-project-name"
              name="name"
              defaultValue={initial.name}
              required
            />
            {errors?.name && (
              <p className="mt-1 text-xs text-destructive">{errors.name[0]}</p>
            )}
          </div>
          <div>
            <Label htmlFor="edit-project-description">Description</Label>
            <Textarea
              id="edit-project-description"
              name="description"
              rows={4}
              defaultValue={initial.description ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="edit-project-tags">Tags</Label>
            <Input
              id="edit-project-tags"
              name="tags"
              defaultValue={initial.tags?.join(", ") ?? ""}
              placeholder="board game, chess"
            />
          </div>
          <div>
            <Label htmlFor="edit-project-repo">Code repository</Label>
            <Input
              id="edit-project-repo"
              name="repoUrl"
              type="url"
              inputMode="url"
              defaultValue={initial.repoUrl ?? ""}
              placeholder="https://github.com/your/repo"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Optional. Link the firmware or source repo for kits with code.
            </p>
            {errors?.repoUrl && (
              <p className="mt-1 text-xs text-destructive">
                {errors.repoUrl[0]}
              </p>
            )}
          </div>

          {initial.photos.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Cover image</Label>
              <p className="text-[11px] text-muted-foreground">
                Pick which photo represents this project in browse and
                profile views. Default falls back to the auto thumbnail.
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1 pt-1">
                <button
                  type="button"
                  onClick={() => setCoverPhotoId("")}
                  aria-pressed={coverPhotoId === ""}
                  className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    coverPhotoId === ""
                      ? "border-primary"
                      : "border-border hover:border-foreground/30"
                  }`}
                >
                  {/* Falls back to the bg gradient when no thumbnail
                      exists — the "Auto" label still applies. */}
                  <div className="absolute inset-0 bg-gradient-to-br from-muted/60 to-muted/30" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[9px] font-medium uppercase tracking-wide text-white">
                    Auto
                  </span>
                </button>
                {initial.photos.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setCoverPhotoId(p.id)}
                    aria-pressed={coverPhotoId === p.id}
                    className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      coverPhotoId === p.id
                        ? "border-primary"
                        : "border-border hover:border-foreground/30"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.downloadUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
              {errors?.coverPhotoId && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.coverPhotoId[0]}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
