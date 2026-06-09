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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateFileListing } from "@/app/actions/files";
import { MATERIALS } from "@/lib/materials";
import { DESIGN_TAG_OPTIONS, DESIGN_TAG_LABELS } from "@/lib/validations/file";
import {
  LICENSES,
  LICENSE_ORDER,
  DEFAULT_LICENSE,
  getLicenseMeta,
  type LicenseId,
} from "@/lib/licenses";

/** A flat CraftCloud material option for the print-material picker. */
export interface CcMaterialOption {
  id: string;
  name: string;
  groupName: string;
}

interface EditFileButtonProps {
  fileId: string;
  initial: {
    name: string;
    description: string | null;
    tags: string[] | null;
    price: number; // cents
    /** May be either a current LicenseId or a legacy enum value. */
    license: string;
    visibility: "public" | "private" | string;
    recommendedMaterialId: string | null;
    /** Direct CraftCloud material UUID — bypasses fuzzy resolver in the print flow. */
    recommendedCcMaterialId: string | null;
    designTags: string[] | null;
    minWallThickness: number | null; // 0.1mm units
    /** Currently-set cover photo id (null = use auto-captured thumbnail). */
    coverPhotoId: string | null;
  };
  /**
   * The file's curator photos — drives the cover-image picker.
   * Empty array means there's nothing to pick from yet, so the
   * picker is hidden and the auto-thumbnail is implicit.
   */
  photos: Array<{ id: string; downloadUrl: string }>;
  hasBuyers: boolean;
  /**
   * CraftCloud materials from the live catalog. When provided, replaces the
   * editorial material list in the "Recommended print material" picker so
   * the creator can pick an exact CraftCloud UUID rather than a near-match slug.
   */
  ccMaterials?: CcMaterialOption[];
  /**
   * Optional custom trigger element. Lets the call site swap in an
   * icon button or any other shape; defaults to a full-width outline
   * button labeled "Edit file".
   */
  trigger?: React.ReactNode;
}

// Map any incoming license value (CC id OR legacy `free`/`personal`/
// `commercial`) to a current CC id so the Select always starts with
// a valid option. Backfill should make this a no-op for fresh data,
// but a stale row from before migration 0012 still renders sanely.
function resolveLicense(raw: string | undefined): LicenseId {
  const meta = getLicenseMeta(raw);
  return meta?.id ?? DEFAULT_LICENSE;
}

export function EditFileButton({
  fileId,
  initial,
  photos,
  hasBuyers,
  ccMaterials,
  trigger,
}: EditFileButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [tags, setTags] = useState((initial.tags ?? []).join(", "));
  const [priceDollars, setPriceDollars] = useState(
    (initial.price / 100).toString()
  );
  const [license, setLicense] = useState<LicenseId>(
    resolveLicense(initial.license)
  );
  const [visibility, setVisibility] = useState<"public" | "private">(
    (initial.visibility as "public" | "private") || "public"
  );
  const [recommendedMaterial, setRecommendedMaterial] = useState(
    initial.recommendedMaterialId ?? ""
  );
  const [recommendedCcMaterial, setRecommendedCcMaterial] = useState(
    initial.recommendedCcMaterialId ?? ""
  );
  const [designTags, setDesignTags] = useState<string[]>(
    initial.designTags ?? []
  );
  const [minWallThicknessMm, setMinWallThicknessMm] = useState(
    initial.minWallThickness ? (initial.minWallThickness / 10).toString() : ""
  );
  // Empty string = auto thumbnail (no override); otherwise the
  // selected curator photo's id.
  const [coverPhotoId, setCoverPhotoId] = useState<string>(
    initial.coverPhotoId ?? ""
  );

  const reset = () => {
    setName(initial.name);
    setDescription(initial.description ?? "");
    setTags((initial.tags ?? []).join(", "));
    setPriceDollars((initial.price / 100).toString());
    setLicense(resolveLicense(initial.license));
    setVisibility((initial.visibility as "public" | "private") || "public");
    setRecommendedMaterial(initial.recommendedMaterialId ?? "");
    setRecommendedCcMaterial(initial.recommendedCcMaterialId ?? "");
    setDesignTags(initial.designTags ?? []);
    setMinWallThicknessMm(
      initial.minWallThickness ? (initial.minWallThickness / 10).toString() : ""
    );
    setCoverPhotoId(initial.coverPhotoId ?? "");
    setSubmitError(null);
  };

  const toggleDesignTag = (tag: string) => {
    setDesignTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setSubmitError(null);

    const formData = new FormData();
    formData.set("name", name);
    formData.set("description", description);
    formData.set("tags", tags);
    formData.set("price", priceDollars || "0");
    formData.set("license", license);
    formData.set("visibility", visibility);
    if (recommendedMaterial) {
      formData.set("recommendedMaterialId", recommendedMaterial);
    }
    if (recommendedCcMaterial) {
      formData.set("recommendedCcMaterialId", recommendedCcMaterial);
    }
    for (const tag of designTags) {
      formData.append("designTags", tag);
    }
    if (minWallThicknessMm) {
      formData.set("minWallThickness", minWallThicknessMm);
    }
    formData.set("coverPhotoId", coverPhotoId);

    startTransition(async () => {
      const result = (await updateFileListing(fileId, formData)) as
        | { success: true }
        | { error: Record<string, string[]> | string }
        | undefined;
      if (result && "error" in result) {
        const flat =
          typeof result.error === "string"
            ? result.error
            : Object.values(result.error).flat()[0] || "Failed to save";
        setSubmitError(String(flat));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          trigger ? (
            (trigger as React.ReactElement)
          ) : (
            <Button variant="outline" className="w-full">
              Edit file
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[90vh] w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit file</DialogTitle>
          <DialogDescription>
            Update how this file is listed. Changes apply immediately.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name" className="text-xs">
              Name
            </Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-description" className="text-xs">
              Description
            </Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={5000}
            />
          </div>

          {photos.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Cover image</Label>
              <p className="text-[11px] text-muted-foreground">
                Pick which photo represents this file in browse and
                profile views. Default is the auto-captured 3D
                thumbnail.
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
                  <img
                    src={`/api/thumbnails/${fileId}?original=1`}
                    alt="Auto-captured thumbnail"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[9px] font-medium uppercase tracking-wide text-white">
                    Auto
                  </span>
                </button>
                {photos.map((p) => (
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
                    <img
                      src={p.downloadUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="edit-tags" className="text-xs">
              Tags
            </Label>
            <Input
              id="edit-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="miniature, tabletop, gaming"
            />
            <p className="text-[11px] text-muted-foreground">
              Comma-separated. Helps people find this file in search.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-visibility" className="text-xs">
              Visibility
            </Label>
            <Select
              value={visibility}
              onValueChange={(v) => setVisibility(v as "public" | "private")}
            >
              <SelectTrigger id="edit-visibility" className="w-full">
                <SelectValue>
                  {(value) =>
                    value === "private" ? "Private" : "Public"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public</SelectItem>
                <SelectItem value="private">Private</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {visibility === "public"
                ? "Appears in browse and search."
                : hasBuyers
                  ? "Hidden from browse and search. Existing buyers and active orders keep their access."
                  : "Hidden from browse and search. Only you can see it."}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-price" className="text-xs">
                Price (USD)
              </Label>
              <Input
                id="edit-price"
                type="number"
                min="0"
                step="0.01"
                value={priceDollars}
                onChange={(e) => setPriceDollars(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Set to 0 for free download.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-license" className="text-xs">
                License
              </Label>
              <Select
                value={license}
                onValueChange={(v) => setLicense(v as LicenseId)}
              >
                <SelectTrigger id="edit-license" className="w-full">
                  <SelectValue>
                    {(value) => {
                      const meta = LICENSES[value as LicenseId];
                      return meta
                        ? `${meta.shortName} — ${meta.name}`
                        : "Select a license";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LICENSE_ORDER.map((id) => {
                    const meta = LICENSES[id];
                    return (
                      <SelectItem key={id} value={id}>
                        <div className="flex flex-col gap-0.5">
                          <span>
                            {meta.shortName} — {meta.name}
                          </span>
                          <span className="whitespace-normal text-[11px] leading-tight text-muted-foreground">
                            {meta.summary}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          {ccMaterials && ccMaterials.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="edit-cc-material" className="text-xs">
                Recommended print material
              </Label>
              <p className="text-[11px] text-muted-foreground">
                When set, users printing this file skip straight to vendor
                selection for this material.
              </p>
              <Select
                value={recommendedCcMaterial || "none"}
                onValueChange={(v) =>
                  setRecommendedCcMaterial(!v || v === "none" ? "" : String(v))
                }
              >
                <SelectTrigger id="edit-cc-material" className="w-full">
                  <SelectValue>
                    {(value) => {
                      if (!value || value === "none") return "None — let the buyer decide";
                      const mat = ccMaterials.find((m) => m.id === value);
                      return mat ? `${mat.name} (${mat.groupName})` : value;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None — let the buyer decide</SelectItem>
                  {ccMaterials.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <span>{m.name}</span>
                      <span className="ml-1.5 text-muted-foreground text-[11px]">{m.groupName}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="edit-material" className="text-xs">
                Recommended material
              </Label>
              <Select
                value={recommendedMaterial || "none"}
                onValueChange={(v) =>
                  setRecommendedMaterial(!v || v === "none" ? "" : String(v))
                }
              >
                <SelectTrigger id="edit-material" className="w-full">
                  <SelectValue>
                    {(value) => {
                      if (!value || value === "none") return "None";
                      const mat = MATERIALS.find((m) => m.id === value);
                      return mat ? `${mat.name} (${mat.method})` : value;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None — let the buyer decide</SelectItem>
                  {MATERIALS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} ({m.method})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">This part needs to be…</Label>
            <div className="flex flex-wrap gap-2">
              {DESIGN_TAG_OPTIONS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleDesignTag(tag)}
                  className={`inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    designTags.includes(tag)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {DESIGN_TAG_LABELS[tag]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-wall" className="text-xs">
              Min wall thickness (mm)
            </Label>
            <Input
              id="edit-wall"
              type="number"
              min="0"
              step="0.1"
              value={minWallThicknessMm}
              onChange={(e) => setMinWallThicknessMm(e.target.value)}
              placeholder="Optional"
            />
          </div>

          {submitError && (
            <p className="text-sm text-destructive">{submitError}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
