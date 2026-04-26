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

interface EditFileButtonProps {
  fileId: string;
  initial: {
    name: string;
    description: string | null;
    tags: string[] | null;
    price: number; // cents
    license: "free" | "personal" | "commercial" | string;
    visibility: "public" | "private" | string;
    recommendedMaterialId: string | null;
    designTags: string[] | null;
    minWallThickness: number | null; // 0.1mm units
  };
  hasBuyers: boolean;
}

export function EditFileButton({
  fileId,
  initial,
  hasBuyers,
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
  const [license, setLicense] = useState<"free" | "personal" | "commercial">(
    (initial.license as "free" | "personal" | "commercial") || "free"
  );
  const [visibility, setVisibility] = useState<"public" | "private">(
    (initial.visibility as "public" | "private") || "public"
  );
  const [recommendedMaterial, setRecommendedMaterial] = useState(
    initial.recommendedMaterialId ?? ""
  );
  const [designTags, setDesignTags] = useState<string[]>(
    initial.designTags ?? []
  );
  const [minWallThicknessMm, setMinWallThicknessMm] = useState(
    initial.minWallThickness ? (initial.minWallThickness / 10).toString() : ""
  );

  const reset = () => {
    setName(initial.name);
    setDescription(initial.description ?? "");
    setTags((initial.tags ?? []).join(", "));
    setPriceDollars((initial.price / 100).toString());
    setLicense((initial.license as "free" | "personal" | "commercial") || "free");
    setVisibility((initial.visibility as "public" | "private") || "public");
    setRecommendedMaterial(initial.recommendedMaterialId ?? "");
    setDesignTags(initial.designTags ?? []);
    setMinWallThicknessMm(
      initial.minWallThickness ? (initial.minWallThickness / 10).toString() : ""
    );
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
    for (const tag of designTags) {
      formData.append("designTags", tag);
    }
    if (minWallThicknessMm) {
      formData.set("minWallThickness", minWallThicknessMm);
    }

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
          <Button variant="outline" className="w-full">
            Edit file
          </Button>
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
                  ? "Hidden from browse and search. Existing buyers keep their download access."
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
                onValueChange={(v) =>
                  setLicense(v as "free" | "personal" | "commercial")
                }
              >
                <SelectTrigger id="edit-license" className="w-full">
                  <SelectValue>
                    {(value) => {
                      if (value === "personal") return "Personal Use";
                      if (value === "commercial") return "Commercial Use";
                      return "Free";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="personal">Personal Use</SelectItem>
                  <SelectItem value="commercial">Commercial Use</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

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
