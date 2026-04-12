"use client";

import { useState, useActionState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { createFileListing } from "@/app/actions/files";
import { MATERIALS } from "@/lib/materials";
import { DESIGN_TAG_OPTIONS } from "@/lib/validations/file";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UploadPreview } from "./upload-preview";

interface UploadedAsset {
  id: string;
  storageKey: string;
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
  const [recommendedMaterial, setRecommendedMaterial] = useState("");
  const [license, setLicense] = useState("free");
  const [sellEnabled, setSellEnabled] = useState(false);

  const primaryAsset = assets[0];

  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      for (const asset of assets) {
        formData.append("assetIds", asset.id);
      }
      for (const tag of selectedDesignTags) {
        formData.append("designTags", tag);
      }
      // If not selling, force price=0 and license=free
      if (!sellEnabled) {
        formData.set("price", "0");
        formData.set("license", "free");
      } else {
        formData.set("license", license);
      }
      if (recommendedMaterial) {
        formData.set("recommendedMaterialId", recommendedMaterial);
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
      {/* 3D Preview at the top */}
      <Card className="overflow-hidden">
        <div className="aspect-[4/3] w-full bg-gradient-to-br from-muted/40 to-muted/10">
          {primaryAsset && (
            <UploadPreview
              storageKey={primaryAsset.storageKey}
              format={
                primaryAsset.format as "stl" | "obj" | "3mf" | "step" | "amf"
              }
            />
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-sm">
          <span className="font-medium truncate">
            {primaryAsset?.originalFilename}
          </span>
          <Badge variant="outline" className="text-[10px] uppercase">
            {primaryAsset?.format}
          </Badge>
          <span className="text-muted-foreground text-xs ml-auto">
            {primaryAsset
              ? `${(primaryAsset.fileSize / 1024 / 1024).toFixed(1)} MB`
              : ""}
          </span>
        </div>
      </Card>

      {/* Basic info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
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

          <div>
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              name="tags"
              placeholder="miniature, tabletop, gaming (comma separated)"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Help people find this file in search.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Sell toggle — the big decision */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">List for sale</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Make this file available to purchase or download publicly.
              </p>
            </div>
            <Switch
              checked={sellEnabled}
              onCheckedChange={setSellEnabled}
            />
          </div>

          <AnimatePresence initial={false}>
            {sellEnabled && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                className="overflow-hidden"
              >
                <div className="grid gap-4 sm:grid-cols-2 pt-4 mt-4 border-t border-border">
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
                    <Label htmlFor="license-trigger">License</Label>
                    <Select
                      value={license}
                      onValueChange={(v) => v && setLicense(v)}
                    >
                      <SelectTrigger id="license-trigger" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="free">Free</SelectItem>
                        <SelectItem value="personal">Personal Use</SelectItem>
                        <SelectItem value="commercial">
                          Commercial Use
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Material intent — optional */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Print Recommendations</CardTitle>
          <p className="text-xs text-muted-foreground">
            Optional. Help printers choose the right material.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="material-trigger">Recommended Material</Label>
            <Select
              value={recommendedMaterial}
              onValueChange={(v) => setRecommendedMaterial(v ?? "")}
            >
              <SelectTrigger id="material-trigger" className="w-full">
                <SelectValue placeholder="None — let the buyer decide" />
              </SelectTrigger>
              <SelectContent>
                {MATERIALS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} ({m.method})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>This part needs to be...</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {DESIGN_TAG_OPTIONS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleDesignTag(tag)}
                  className={`inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
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
              We&apos;ll warn printers if their chosen material can&apos;t
              support this
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="flex-1"
          render={<Link href="/" />}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={pending || assets.length === 0}
          size="lg"
          className="flex-1"
        >
          {pending ? "Saving..." : sellEnabled ? "Create listing" : "Save to library"}
        </Button>
      </div>
    </form>
  );
}
