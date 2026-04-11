"use client";

import { useState } from "react";
import { useActionState } from "react";
import { createFileListing } from "@/app/actions/files";
import { MATERIALS } from "@/lib/materials";
import { DESIGN_TAG_OPTIONS } from "@/lib/validations/file";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface UploadedAsset {
  id: string;
  originalFilename: string;
  format: string;
  fileSize: number;
}

interface FileMetadataFormProps {
  assets: UploadedAsset[];
}

const DESIGN_TAG_LABELS: Record<string, string> = {
  strong: "Strong",
  flexible: "Flexible",
  "heat-resistant": "Heat Resistant",
  watertight: "Watertight",
  detailed: "Detailed",
  lightweight: "Lightweight",
};

export function FileMetadataForm({ assets }: FileMetadataFormProps) {
  const [selectedDesignTags, setSelectedDesignTags] = useState<string[]>([]);
  const [selectedMaterial, setSelectedMaterial] = useState("");

  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      for (const asset of assets) {
        formData.append("assetIds", asset.id);
      }
      for (const tag of selectedDesignTags) {
        formData.append("designTags", tag);
      }
      return createFileListing(formData);
    },
    null
  );

  const errors = state && "error" in state ? state.error : null;

  const toggleDesignTag = (tag: string) => {
    setSelectedDesignTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  return (
    <form action={formAction} className="space-y-6">
      {/* Basic info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">File Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required placeholder="My 3D Model" />
            {errors?.name && (
              <p className="mt-1 text-xs text-destructive">{errors.name[0]}</p>
            )}
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              rows={4}
              placeholder="Describe your 3D model..."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="price">Price (USD)</Label>
              <Input
                id="price"
                name="price"
                type="number"
                min="0"
                step="0.01"
                defaultValue="0"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Set to 0 for free download
              </p>
            </div>

            <div>
              <Label htmlFor="license">License</Label>
              <select
                id="license"
                name="license"
                defaultValue="free"
                className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs"
              >
                <option value="free">Free</option>
                <option value="personal">Personal Use</option>
                <option value="commercial">Commercial Use</option>
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              name="tags"
              placeholder="miniature, tabletop, gaming (comma separated)"
            />
          </div>
        </CardContent>
      </Card>

      {/* Material intent — optional */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Print Recommendations</CardTitle>
          <p className="text-xs text-muted-foreground">
            Optional. Help buyers choose the right material for your design.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="recommendedMaterialId">Recommended Material</Label>
            <select
              id="recommendedMaterialId"
              name="recommendedMaterialId"
              value={selectedMaterial}
              onChange={(e) => setSelectedMaterial(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs"
            >
              <option value="">None — let the buyer decide</option>
              {MATERIALS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.method})
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label>This part needs to be...</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {DESIGN_TAG_OPTIONS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleDesignTag(tag)}
                  className={`inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedDesignTags.includes(tag)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {DESIGN_TAG_LABELS[tag]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="minWallThickness">
              Minimum Wall Thickness (mm)
            </Label>
            <Input
              id="minWallThickness"
              name="minWallThickness"
              type="number"
              min="0"
              max="100"
              step="0.1"
              placeholder="e.g. 1.0"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              We&apos;ll warn buyers if their chosen material can&apos;t support this
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Uploaded files */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uploaded Files</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm"
              >
                <span className="font-medium">{asset.originalFilename}</span>
                <Badge variant="outline" className="text-[10px] uppercase">
                  {asset.format}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {(asset.fileSize / 1024 / 1024).toFixed(1)} MB
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Button type="submit" disabled={pending || assets.length === 0} size="lg" className="w-full">
        {pending ? "Creating..." : "Create Listing"}
      </Button>
    </form>
  );
}
