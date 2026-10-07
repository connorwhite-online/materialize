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
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  CoverPicker,
  LicenseField,
  VisibilityField,
} from "@/components/upload/form-fields";
import { updateProject } from "@/app/actions/projects";
import { CategorySelect } from "@/components/categories/category-select";
import {
  DEFAULT_LICENSE,
  getLicenseMeta,
  type LicenseId,
} from "@/lib/licenses";

function resolveLicense(raw: string | undefined): LicenseId {
  const meta = getLicenseMeta(raw);
  return meta?.id ?? DEFAULT_LICENSE;
}

interface Props {
  projectId: string;
  initial: {
    name: string;
    description: string | null;
    tags: string[] | null;
    category: string | null;
    repoUrl: string | null;
    license: string;
    visibility: "public" | "private";
    coverPhotoId: string | null;
    /**
     * Curator photos that are eligible to be picked as the cover.
     * The form omits the picker entirely when this list is empty —
     * a project with no curator photos can only fall back to the
     * legacy thumbnail.
     */
    photos: Array<{ id: string; downloadUrl: string }>;
  };
  /**
   * Optional custom trigger element. Lets the call site swap in an
   * icon button or any other shape; defaults to a secondary button
   * labeled "Edit details".
   */
  trigger?: React.ReactNode;
}

/**
 * Owner-only dialog for project metadata that doesn't fit elsewhere —
 * name, description, tags, license, and the optional code-repo URL.
 * Lives on the project sidebar alongside the BOM editor.
 */
export function EditProjectDialog({ projectId, initial, trigger }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);
  const [license, setLicense] = useState<LicenseId>(
    resolveLicense(initial.license),
  );
  const [category, setCategory] = useState(initial.category ?? "");
  const [visibility, setVisibility] = useState<"public" | "private">(
    initial.visibility,
  );
  // Empty string = auto thumbnail (no override); otherwise the selected
  // curator photo's id. Mirrors edit-file-button.tsx.
  const [coverPhotoId, setCoverPhotoId] = useState<string>(
    initial.coverPhotoId ?? "",
  );

  const handleSubmit = (formData: FormData) => {
    setErrors(null);
    // Always include the cover field so the server action knows the
    // user actually opened the dialog and made a decision (empty
    // string clears, populated string picks).
    formData.set("license", license);
    formData.set("category", category);
    formData.set("visibility", visibility);
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
          trigger ? (
            (trigger as React.ReactElement)
          ) : (
            <Button variant="secondary">Edit details</Button>
          )
        }
      />
      {/* sm:max-w-lg overrides the base popup's sm:max-w-sm; min-w-0
          on the grid children lets the long description + inputs wrap
          to the cap instead of overflowing it (the base DialogContent
          is a grid, whose tracks otherwise size to content). */}
      <DialogContent className="max-h-[90vh] w-full overflow-y-auto sm:max-w-lg">
        <DialogHeader className="min-w-0">
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>
            Changes show on the project page as soon as you save.
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex min-w-0 flex-col gap-5">
          <Field
            label="Name"
            htmlFor="edit-project-name"
            error={errors?.name?.[0]}
          >
            <Input
              id="edit-project-name"
              name="name"
              defaultValue={initial.name}
              required
              aria-invalid={errors?.name ? true : undefined}
            />
          </Field>
          <Field
            label="Description"
            htmlFor="edit-project-description"
            optional
          >
            <Textarea
              id="edit-project-description"
              name="description"
              rows={4}
              defaultValue={initial.description ?? ""}
            />
          </Field>

          {initial.photos.length > 0 && (
            <CoverPicker
              autoSrc={initial.photos[0].downloadUrl}
              photos={initial.photos}
              value={coverPhotoId}
              onChange={setCoverPhotoId}
              hint="Shown in browse and on your profile. Auto uses your first photo."
              error={errors?.coverPhotoId?.[0]}
            />
          )}

          <div className="grid min-w-0 gap-5 sm:grid-cols-2">
            <Field label="Category" htmlFor="edit-project-category">
              <CategorySelect
                id="edit-project-category"
                value={category}
                onValueChange={setCategory}
              />
            </Field>
            <Field
              label="Tags"
              htmlFor="edit-project-tags"
              optional
              hint="Comma separated."
            >
              <Input
                id="edit-project-tags"
                name="tags"
                defaultValue={initial.tags?.join(", ") ?? ""}
                placeholder="board game, chess"
              />
            </Field>
          </div>

          <VisibilityField
            name="edit-project-visibility"
            value={visibility}
            onChange={setVisibility}
          />
          <LicenseField
            id="edit-project-license"
            value={license}
            onChange={setLicense}
          />

          <Field
            label="Code repository"
            htmlFor="edit-project-repo"
            optional
            hint="Firmware or source for kits with electronics."
            error={errors?.repoUrl?.[0]}
          >
            <Input
              id="edit-project-repo"
              name="repoUrl"
              type="url"
              inputMode="url"
              defaultValue={initial.repoUrl ?? ""}
              placeholder="https://github.com/your/repo"
              aria-invalid={errors?.repoUrl ? true : undefined}
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
            <Button type="submit" loading={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
