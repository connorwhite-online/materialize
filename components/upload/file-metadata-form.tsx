"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { listMyCollections } from "@/app/actions/collections";
import { listMyProjects } from "@/app/actions/projects";
import { runCreateListing } from "./run-create-listing";
import { MATERIALS } from "@/lib/materials";
import { DESIGN_TAG_OPTIONS, DESIGN_TAG_LABELS } from "@/lib/validations/file";
import {
  LICENSES,
  LICENSE_ORDER,
  DEFAULT_LICENSE,
  type LicenseId,
} from "@/lib/licenses";
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
import dynamic from "next/dynamic";
import { OwnerPicker } from "@/components/orgs/owner-picker";

// UploadPreview pulls three.js + @react-three/fiber + drei. Any caller
// that statically imports this form (home-bottom-bar, upload-dialog,
// picked-file-actions) inherits that cost — and at least the home
// page renders the dialog lazily, so the eager chunk pull was a real
// regression on TTI. Lazy-loading UploadPreview here cuts the three.js
// dependency off the critical path for every consumer. The form
// itself stays static; only the 3D viewport is deferred. ssr:false is
// safe because UploadPreview already depends on browser-only APIs
// (Canvas, blob URLs) and was never server-rendered anyway.
const UploadPreview = dynamic(
  () => import("./upload-preview").then((m) => m.UploadPreview),
  {
    ssr: false,
    loading: () => <div className="h-full w-full" aria-hidden />,
  }
);

interface FileMetadataFormProps {
  /** In-memory file picked by the user — uploaded to R2 on form submit. */
  file: File;
  /** Format derived from the file extension. */
  format: "stl" | "obj" | "3mf" | "step" | "amf";
  /**
   * If provided, the cancel button calls this instead of linking
   * back to the home page. Used when the form is mounted inside a
   * dialog so cancel just closes the modal.
   */
  onCancel?: () => void;
  /**
   * Pre-selects the "Project" picker. Set when the form is launched
   * from a project's "Add files" modal so the upload lands straight
   * in that bundle.
   */
  initialProjectId?: string;
}

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

export function FileMetadataForm({
  file,
  format,
  onCancel,
  initialProjectId,
}: FileMetadataFormProps) {
  const [selectedDesignTags, setSelectedDesignTags] = useState<string[]>([]);
  const [recommendedMaterial, setRecommendedMaterial] = useState("");
  const [license, setLicense] = useState<LicenseId>(DEFAULT_LICENSE);
  const [sellEnabled, setSellEnabled] = useState(false);
  const [printRecOpen, setPrintRecOpen] = useState(false);
  const [fileUnit, setFileUnit] = useState<"mm" | "cm" | "in">("mm");
  const [dimensions, setDimensions] = useState<
    [number, number, number] | null
  >(null);

  // Collections
  const [userCollections, setUserCollections] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [collectionChoice, setCollectionChoice] = useState<string>("none");
  const [newCollectionName, setNewCollectionName] = useState("");

  // Projects (bundles). Pre-selected when launched from a project.
  const [userProjects, setUserProjects] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [projectChoice, setProjectChoice] = useState<string>(
    initialProjectId ?? "none"
  );

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
    listMyProjects().then((rows) => {
      if (!cancelled) setUserProjects(rows);
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

    const result = await runCreateListing({
      file,
      fileUnit,
      formData,
      selectedDesignTags,
      recommendedMaterial,
      sellEnabled,
      license,
      collectionChoice,
      newCollectionName,
      projectChoice,
      onProgress: setProgress,
      onPhaseChange: setPhase,
    });

    if (!result.ok) {
      if (result.fieldErrors) setErrors(result.fieldErrors);
      if (result.error) setSubmitError(result.error);
      setPhase("idle");
    }
    // On success the server action redirects — we never reach here.
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
                ? `${formatDim(dimensions[0])} × ${formatDim(dimensions[1])} × ${formatDim(dimensions[2])} ${fileUnit}`
                : "Measuring..."}
            </div>
          </div>
          <Select
            value={fileUnit}
            onValueChange={(v) =>
              setFileUnit((v as "mm" | "cm" | "in") ?? "mm")
            }
          >
            <SelectTrigger size="sm" className="shrink-0">
              <SelectValue>
                {(value) => {
                  if (value === "cm") return "cm";
                  if (value === "in") return "inches";
                  return "mm";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mm">Millimeters</SelectItem>
              <SelectItem value="cm">Centimeters</SelectItem>
              <SelectItem value="in">Inches</SelectItem>
            </SelectContent>
          </Select>
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
          {/* "Create as" selector — picks personal vs. an org owner.
              Renders only when the user has org memberships; falls
              through to a hidden personal value otherwise. */}
          <OwnerPicker label="Create as" />

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

          {userProjects.length > 0 && (
            <div>
              <Label htmlFor="project-trigger">Project</Label>
              <Select
                value={projectChoice}
                onValueChange={(v) => v && setProjectChoice(v)}
              >
                <SelectTrigger id="project-trigger" className="w-full">
                  <SelectValue>
                    {(value) => {
                      if (!value || value === "none") return "No project";
                      const found = userProjects.find((p) => p.id === value);
                      return found?.name ?? "No project";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {userProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Bundle this file into a project to sell it as part of a set.
              </p>
            </div>
          )}
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
                      onValueChange={(v) => v && setLicense(v as LicenseId)}
                    >
                      <SelectTrigger id="license-trigger" className="w-full">
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
                                <span className="whitespace-normal text-[11px] text-muted-foreground leading-tight">
                                  {meta.summary}
                                </span>
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Controls what buyers can do with the files after download.
                    </p>
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
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="flex-1"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="flex-1"
            render={<Link href="/" />}
          >
            Cancel
          </Button>
        )}
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
