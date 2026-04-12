"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { createFileListing } from "@/app/actions/files";
import { listMyCollections } from "@/app/actions/collections";
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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UploadPreview } from "./upload-preview";

interface FileMetadataFormProps {
  /** In-memory file picked by the user — uploaded to R2 on form submit. */
  file: File;
  /** Format derived from the file extension. */
  format: "stl" | "obj" | "3mf" | "step" | "amf";
}

const DESIGN_TAG_LABELS: Record<string, string> = {
  strong: "Strong",
  flexible: "Flexible",
  "heat-resistant": "Heat Resistant",
  watertight: "Watertight",
  detailed: "Detailed",
  lightweight: "Lightweight",
};

function formatDim(n: number) {
  return n.toFixed(1);
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

type SubmitPhase = "idle" | "uploading" | "saving";

export function FileMetadataForm({ file, format }: FileMetadataFormProps) {
  const [selectedDesignTags, setSelectedDesignTags] = useState<string[]>([]);
  const [recommendedMaterial, setRecommendedMaterial] = useState("");
  const [license, setLicense] = useState("free");
  const [sellEnabled, setSellEnabled] = useState(false);
  const [printRecOpen, setPrintRecOpen] = useState(false);
  const [dimensions, setDimensions] = useState<
    [number, number, number] | null
  >(null);

  // Collections
  const [userCollections, setUserCollections] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [collectionChoice, setCollectionChoice] = useState<string>("none");
  const [newCollectionName, setNewCollectionName] = useState("");

  // Submit state
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[] | undefined> | null>(
    null
  );
  const isSubmitting = phase !== "idle";

  useEffect(() => {
    let cancelled = false;
    listMyCollections().then((rows) => {
      if (!cancelled) setUserCollections(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleDesignTag = (tag: string) => {
    setSelectedDesignTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const expandTransition = {
    duration: 0.22,
    ease: [0.2, 0.8, 0.2, 1] as [number, number, number, number],
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    // Snapshot FormData synchronously — React pools form events and
    // nulls currentTarget by the time our awaits resolve.
    const formData = new FormData(e.currentTarget);

    setSubmitError(null);
    setErrors(null);

    try {
      // 1. Get a presigned URL for R2.
      setPhase("uploading");
      setProgress(0);
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: "application/octet-stream",
          fileSize: file.size,
        }),
      });
      if (!presignRes.ok) {
        const data = await presignRes.json().catch(() => ({}));
        throw new Error(data.error || `Presign failed (${presignRes.status})`);
      }
      const { uploadUrl, storageKey, format: serverFormat } =
        (await presignRes.json()) as {
          uploadUrl: string;
          storageKey: string;
          format: typeof format;
        };

      // 2. PUT the file to R2 with progress.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", (ev) => {
          if (ev.lengthComputable) {
            setProgress(Math.round((ev.loaded / ev.total) * 100));
          }
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(
              new Error(
                `R2 upload failed (${xhr.status}). Check R2 CORS settings.`
              )
            );
          }
        });
        xhr.addEventListener("error", () =>
          reject(new Error("Network error uploading to R2."))
        );
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.send(file);
      });

      // 3. Hand off to the server action to create the file row + asset
      //    row + optional collection link, then redirect to the new file.
      setPhase("saving");
      formData.set(
        "assetsJson",
        JSON.stringify([
          {
            storageKey,
            originalFilename: file.name,
            format: serverFormat,
            fileSize: file.size,
          },
        ])
      );
      for (const tag of selectedDesignTags) {
        formData.append("designTags", tag);
      }
      if (!sellEnabled) {
        formData.set("price", "0");
        formData.set("license", "free");
      } else {
        formData.set("license", license);
      }
      if (recommendedMaterial) {
        formData.set("recommendedMaterialId", recommendedMaterial);
      }
      formData.set("collectionId", collectionChoice);
      if (collectionChoice === "__new__") {
        formData.set("newCollectionName", newCollectionName);
      }

      const result = await createFileListing(formData);
      // On success the action calls redirect() and we never reach here.
      if (result && "error" in result && result.error) {
        setErrors(
          result.error as Record<string, string[] | undefined>
        );
        setPhase("idle");
        return;
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Save failed");
      setPhase("idle");
    }
  };

  const submitLabel = (() => {
    if (phase === "uploading") return `Uploading… ${progress}%`;
    if (phase === "saving") return "Saving…";
    return sellEnabled ? "Create listing" : "Save to library";
  })();

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 3D Preview at the top */}
      <Card className="overflow-hidden py-0">
        <div className="aspect-[4/3] w-full bg-gradient-to-br from-muted/40 to-muted/10">
          <UploadPreview
            file={file}
            format={format}
            onDimensionsComputed={setDimensions}
          />
        </div>
        <div className="flex items-center gap-3 border-t border-border px-4 py-2.5 text-sm">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{file.name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {dimensions
                ? `${formatDim(dimensions[0])} × ${formatDim(dimensions[1])} × ${formatDim(dimensions[2])} mm`
                : "Measuring..."}
            </div>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {(file.size / 1024 / 1024).toFixed(1)} MB
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
            {errors?.name && errors.name[0] && (
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

          <div>
            <Label htmlFor="collection-trigger">Collection</Label>
            <Select
              value={collectionChoice}
              onValueChange={(v) => v && setCollectionChoice(v)}
            >
              <SelectTrigger id="collection-trigger" className="w-full">
                <SelectValue>
                  {(value) => {
                    if (!value || value === "none") return "No collection";
                    if (value === "__new__") return "+ Create new collection";
                    const found = userCollections.find((c) => c.id === value);
                    return found?.name ?? "No collection";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No collection</SelectItem>
                {userCollections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
                <SelectItem value="__new__">+ Create new collection</SelectItem>
              </SelectContent>
            </Select>
            <AnimatePresence initial={false}>
              {collectionChoice === "__new__" && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={expandTransition}
                  className="overflow-hidden"
                >
                  <div className="pt-3">
                    <Input
                      value={newCollectionName}
                      onChange={(e) => setNewCollectionName(e.target.value)}
                      placeholder="Collection name"
                      autoFocus
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </CardContent>
      </Card>

      {/* Sell toggle — the big decision */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <CardTitle className="text-base">List for sale</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Make this file available to purchase or download publicly.
              </p>
            </div>
            <Switch checked={sellEnabled} onCheckedChange={setSellEnabled} />
          </div>
        </CardHeader>
        <AnimatePresence initial={false}>
          {sellEnabled && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={expandTransition}
              className="overflow-hidden"
            >
              <CardContent>
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
                    <Label htmlFor="license-trigger">License</Label>
                    <Select
                      value={license}
                      onValueChange={(v) => v && setLicense(v)}
                    >
                      <SelectTrigger id="license-trigger" className="w-full">
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
                        <SelectItem value="commercial">
                          Commercial Use
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* Print recommendations — optional, collapsed by default */}
      <Card>
        <button
          type="button"
          onClick={() => setPrintRecOpen((v) => !v)}
          className="cursor-pointer text-left"
        >
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <CardTitle className="text-base">
                  Print Recommendations
                </CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Optional. Help printers choose the right material.
                </p>
              </div>
              <motion.div
                animate={{ rotate: printRecOpen ? 180 : 0 }}
                transition={expandTransition}
                className="text-muted-foreground"
              >
                <ChevronDownIcon />
              </motion.div>
            </div>
          </CardHeader>
        </button>
        <AnimatePresence initial={false}>
          {printRecOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={expandTransition}
              className="overflow-hidden"
            >
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="material-trigger">Recommended Material</Label>
                  <Select
                    value={recommendedMaterial}
                    onValueChange={(v) => setRecommendedMaterial(v ?? "")}
                  >
                    <SelectTrigger id="material-trigger" className="w-full">
                      <SelectValue placeholder="None — let the buyer decide">
                        {(value) => {
                          if (!value) return "None — let the buyer decide";
                          const mat = MATERIALS.find((m) => m.id === value);
                          return mat ? `${mat.name} (${mat.method})` : value;
                        }}
                      </SelectValue>
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
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* Inline error */}
      {submitError && (
        <p className="text-sm text-destructive">{submitError}</p>
      )}

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
          disabled={isSubmitting}
          size="lg"
          className="flex-1"
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
