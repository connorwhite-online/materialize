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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateFileListing } from "@/app/actions/files";
import { MATERIALS } from "@/lib/materials";
import { MAX_PRICE_CENTS } from "@/lib/validations/file";
import {
  CoverPicker,
  DesignTagChips,
  FormError,
  FormSection,
  LicenseField,
  PriceInput,
  VisibilityField,
} from "@/components/upload/form-fields";
import { CategorySelect } from "@/components/categories/category-select";
import {
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

/** A CraftCloud finish group option for the finish-group picker. */
export interface CcFinishGroupOption {
  id: string;
  name: string;
}

interface EditFileButtonProps {
  fileId: string;
  initial: {
    name: string;
    description: string | null;
    tags: string[] | null;
    category: string | null;
    price: number; // cents
    /** May be either a current LicenseId or a legacy enum value. */
    license: string;
    visibility: "public" | "private" | string;
    recommendedMaterialId: string | null;
    /** Direct CraftCloud material UUID — bypasses fuzzy resolver in the print flow. */
    recommendedCcMaterialId: string | null;
    /** CraftCloud finish group UUID — when set alongside CC material, print flow jumps to vendor. */
    recommendedCcFinishGroupId: string | null;
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
   * Finish groups keyed by CraftCloud material id. When the creator
   * picks a CC material, the finish group picker populates from this map
   * so they can also pre-scope to a specific finish, which sends buyers
   * directly to vendor selection.
   */
  ccFinishGroups?: Record<string, CcFinishGroupOption[]>;
  /**
   * Optional custom trigger element. Lets the call site swap in an
   * icon button or any other shape; defaults to a secondary button
   * labeled "Edit file".
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
  ccFinishGroups,
  trigger,
}: EditFileButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [tags, setTags] = useState((initial.tags ?? []).join(", "));
  const [category, setCategory] = useState(initial.category ?? "");
  const [priceDollars, setPriceDollars] = useState(
    (initial.price / 100).toString(),
  );
  const [license, setLicense] = useState<LicenseId>(
    resolveLicense(initial.license),
  );
  const [visibility, setVisibility] = useState<"public" | "private">(
    (initial.visibility as "public" | "private") || "public",
  );
  const [recommendedMaterial, setRecommendedMaterial] = useState(
    initial.recommendedMaterialId ?? "",
  );
  const [recommendedCcMaterial, setRecommendedCcMaterial] = useState(
    initial.recommendedCcMaterialId ?? "",
  );
  const [recommendedCcFinishGroup, setRecommendedCcFinishGroup] = useState(
    initial.recommendedCcFinishGroupId ?? "",
  );
  const [designTags, setDesignTags] = useState<string[]>(
    initial.designTags ?? [],
  );
  const [minWallThicknessMm, setMinWallThicknessMm] = useState(
    initial.minWallThickness ? (initial.minWallThickness / 10).toString() : "",
  );
  // Empty string = auto thumbnail (no override); otherwise the
  // selected curator photo's id.
  const [coverPhotoId, setCoverPhotoId] = useState<string>(
    initial.coverPhotoId ?? "",
  );

  const reset = () => {
    setName(initial.name);
    setDescription(initial.description ?? "");
    setTags((initial.tags ?? []).join(", "));
    setCategory(initial.category ?? "");
    setPriceDollars((initial.price / 100).toString());
    setLicense(resolveLicense(initial.license));
    setVisibility((initial.visibility as "public" | "private") || "public");
    setRecommendedMaterial(initial.recommendedMaterialId ?? "");
    setRecommendedCcMaterial(initial.recommendedCcMaterialId ?? "");
    setRecommendedCcFinishGroup(initial.recommendedCcFinishGroupId ?? "");
    setDesignTags(initial.designTags ?? []);
    setMinWallThicknessMm(
      initial.minWallThickness
        ? (initial.minWallThickness / 10).toString()
        : "",
    );
    setCoverPhotoId(initial.coverPhotoId ?? "");
    setSubmitError(null);
  };

  const toggleDesignTag = (tag: string) => {
    setDesignTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
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
    formData.set("category", category);
    formData.set("price", priceDollars || "0");
    formData.set("license", license);
    formData.set("visibility", visibility);
    if (recommendedMaterial) {
      formData.set("recommendedMaterialId", recommendedMaterial);
    }
    if (recommendedCcMaterial) {
      formData.set("recommendedCcMaterialId", recommendedCcMaterial);
    }
    if (recommendedCcFinishGroup) {
      formData.set("recommendedCcFinishGroupId", recommendedCcFinishGroup);
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
            <Button variant="secondary">Edit file</Button>
          )
        }
      />
      <DialogContent className="max-h-[90vh] w-full overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit file</DialogTitle>
          <DialogDescription>
            Changes show on the listing as soon as you save.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-8">
          <FormSection title="Details">
            <Field label="Name" htmlFor="edit-name">
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
              />
            </Field>

            <Field label="Description" htmlFor="edit-description" optional>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={5000}
              />
            </Field>

            {photos.length > 0 && (
              <CoverPicker
                autoSrc={`/api/thumbnails/${fileId}?original=1`}
                photos={photos}
                value={coverPhotoId}
                onChange={setCoverPhotoId}
                hint="Shown in browse and on your profile. Auto is the 3D preview."
              />
            )}

            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              <Field label="Category" htmlFor="edit-category">
                <CategorySelect
                  id="edit-category"
                  value={category}
                  onValueChange={setCategory}
                />
              </Field>
              <Field
                label="Tags"
                htmlFor="edit-tags"
                optional
                hint="Comma separated."
              >
                <Input
                  id="edit-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="miniature, tabletop"
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Sharing">
            <VisibilityField
              name="edit-visibility"
              value={visibility}
              onChange={setVisibility}
              privateDescription={
                hasBuyers
                  ? "Hidden from browse. Buyers keep access."
                  : "Only you can see it."
              }
            />
            <div className="grid min-w-0 gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <LicenseField
                id="edit-license"
                value={license}
                onChange={setLicense}
              />
              <Field label="Price" htmlFor="edit-price" hint="USD. 0 is free.">
                <PriceInput
                  id="edit-price"
                  max={MAX_PRICE_CENTS / 100}
                  value={priceDollars}
                  onChange={(e) => setPriceDollars(e.target.value)}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection
            title="Printing"
            description="Optional. Help buyers order the right print."
          >
            {ccMaterials && ccMaterials.length > 0 ? (
              <>
                <Field
                  label="Recommended material"
                  htmlFor="edit-cc-material"
                  hint="Buyers printing this file skip straight to vendors for it."
                >
                  <Select
                    value={recommendedCcMaterial || "none"}
                    onValueChange={(v) => {
                      const next = !v || v === "none" ? "" : String(v);
                      setRecommendedCcMaterial(next);
                      // Clear finish group when material changes — the previous finish
                      // group may not exist for the newly selected material.
                      if (next !== recommendedCcMaterial)
                        setRecommendedCcFinishGroup("");
                    }}
                  >
                    <SelectTrigger id="edit-cc-material" className="w-full">
                      <SelectValue>
                        {(value) => {
                          if (!value || value === "none")
                            return "None — let the buyer decide";
                          const mat = ccMaterials.find((m) => m.id === value);
                          return mat ? `${mat.name} (${mat.groupName})` : value;
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        None — let the buyer decide
                      </SelectItem>
                      {ccMaterials.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          <span>{m.name}</span>
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {m.groupName}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {/* Finish group picker — only shown when a CC material is selected
                    and the catalog provides finish groups for it. */}
                {recommendedCcMaterial &&
                  ccFinishGroups &&
                  (ccFinishGroups[recommendedCcMaterial]?.length ?? 0) > 1 && (
                    <Field
                      label="Recommended finish"
                      htmlFor="edit-cc-finish-group"
                      optional
                      hint="Buyers land directly on vendors for this finish."
                    >
                      <Select
                        value={recommendedCcFinishGroup || "none"}
                        onValueChange={(v) =>
                          setRecommendedCcFinishGroup(
                            !v || v === "none" ? "" : String(v),
                          )
                        }
                      >
                        <SelectTrigger
                          id="edit-cc-finish-group"
                          className="w-full"
                        >
                          <SelectValue>
                            {(value) => {
                              if (!value || value === "none")
                                return "Any finish — buyer decides";
                              const fg = ccFinishGroups[
                                recommendedCcMaterial
                              ]?.find((f) => f.id === value);
                              return fg ? fg.name : value;
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            Any finish — buyer decides
                          </SelectItem>
                          {(ccFinishGroups[recommendedCcMaterial] ?? []).map(
                            (fg) => (
                              <SelectItem key={fg.id} value={fg.id}>
                                {fg.name}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
              </>
            ) : (
              <Field label="Recommended material" htmlFor="edit-material">
                <Select
                  value={recommendedMaterial || "none"}
                  onValueChange={(v) =>
                    setRecommendedMaterial(!v || v === "none" ? "" : String(v))
                  }
                >
                  <SelectTrigger id="edit-material" className="w-full">
                    <SelectValue>
                      {(value) => {
                        if (!value || value === "none")
                          return "None — let the buyer decide";
                        const mat = MATERIALS.find((m) => m.id === value);
                        return mat ? `${mat.name} (${mat.method})` : value;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      None — let the buyer decide
                    </SelectItem>
                    {MATERIALS.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} ({m.method})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            <DesignTagChips selected={designTags} onToggle={toggleDesignTag} />

            <Field
              label="Min wall thickness"
              htmlFor="edit-wall"
              optional
              hint="In millimetres."
              className="max-w-[18rem]"
            >
              <Input
                id="edit-wall"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={minWallThicknessMm}
                onChange={(e) => setMinWallThicknessMm(e.target.value)}
                placeholder="0.8"
                className="tabular-nums"
              />
            </Field>
          </FormSection>

          <div className="flex flex-col gap-3">
            <FormError>{submitError}</FormError>
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
                Save changes
              </Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
