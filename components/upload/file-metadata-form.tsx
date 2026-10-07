"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { listMyCollections } from "@/app/actions/collections";
import { listMyProjects } from "@/app/actions/projects";
import {
  runCreateListing,
  type DuplicateUploadMatch,
} from "./run-create-listing";
import { DuplicateUploadDialog } from "./duplicate-upload-dialog";
import { MATERIALS } from "@/lib/materials";
import { MAX_PRICE_CENTS } from "@/lib/validations/file";
import { CategorySelect } from "@/components/categories/category-select";
import { DEFAULT_LICENSE, type LicenseId } from "@/lib/licenses";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Field, FormActions } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DesignTagChips,
  FormError,
  FormSection,
  LicenseField,
  PriceInput,
  SaleField,
  VisibilityField,
} from "./form-fields";
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
  },
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

function nameFromFileName(fileName: string) {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_\-.]+/g, " ")
    .trim();
  if (!base) return "";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
  const [category, setCategory] = useState("");
  const [recommendedMaterial, setRecommendedMaterial] = useState("");
  const [license, setLicense] = useState<LicenseId>(DEFAULT_LICENSE);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [sellEnabled, setSellEnabled] = useState(false);
  const [printRecOpen, setPrintRecOpen] = useState(false);
  const [fileUnit, setFileUnit] = useState<"mm" | "cm" | "in">("mm");
  const [dimensions, setDimensions] = useState<[number, number, number] | null>(
    null,
  );

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
    initialProjectId ?? "none",
  );

  // Submit state
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [duplicateMatch, setDuplicateMatch] =
    useState<DuplicateUploadMatch | null>(null);
  const [errors, setErrors] = useState<Record<
    string,
    string[] | undefined
  > | null>(null);
  const isSubmitting = phase !== "idle";
  // Start the name from the file name ("cable_clip-v2.stl" → "Cable
  // clip v2") so the one required field is usually already right.
  const defaultName = nameFromFileName(file.name);

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
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
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
    setDuplicateMatch(null);

    const result = await runCreateListing({
      file,
      fileUnit,
      formData,
      selectedDesignTags,
      category,
      recommendedMaterial,
      sellEnabled,
      license,
      visibility,
      collectionChoice,
      newCollectionName,
      projectChoice,
      onProgress: setProgress,
      onPhaseChange: setPhase,
    });

    if (!result.ok) {
      if (result.duplicate) setDuplicateMatch(result.duplicate);
      if ("fieldErrors" in result && result.fieldErrors) {
        setErrors(result.fieldErrors);
      }
      if ("error" in result && result.error) setSubmitError(result.error);
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
    <form onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-8">
      {/* The object first: preview, file name, measured size and the
          unit it was modelled in. */}
      <div className="flex min-w-0 flex-col gap-3">
        <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-muted sm:aspect-[16/9]">
          <UploadPreview
            file={file}
            format={format}
            onDimensionsComputed={setDimensions}
          />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-5 font-medium">
              {file.name}
            </p>
            <p className="text-[13px] leading-[18px] text-muted-foreground tabular-nums">
              {dimensions
                ? `${formatDim(dimensions[0])} × ${formatDim(dimensions[1])} × ${formatDim(dimensions[2])} ${fileUnit}`
                : "Measuring…"}
              <span aria-hidden> · </span>
              {formatBytes(file.size)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              id="file-unit-label"
              className="text-[13px] text-muted-foreground"
            >
              Units
            </span>
            <SegmentedControl
              items={[
                { value: "mm", label: "mm" },
                { value: "cm", label: "cm" },
                { value: "in", label: "in" },
              ]}
              value={fileUnit}
              onValueChange={(v) => setFileUnit(v)}
              listClassName="w-auto"
            />
          </div>
        </div>
      </div>

      <FormSection title="Details">
        {/* "Create as" selector — picks personal vs. an org owner.
            Renders only when the user has org memberships; falls
            through to a hidden personal value otherwise. */}
        <OwnerPicker label="Create as" />

        <Field label="Name" htmlFor="name" error={errors?.name?.[0]}>
          <Input
            id="name"
            name="name"
            required
            defaultValue={defaultName}
            placeholder="Cable clip"
            aria-invalid={errors?.name?.[0] ? true : undefined}
          />
        </Field>

        <Field label="Description" htmlFor="description" optional>
          <Textarea
            id="description"
            name="description"
            rows={3}
            placeholder="What it is, what it fits, how to print it."
          />
        </Field>

        <div className="grid min-w-0 gap-5 sm:grid-cols-2">
          <Field
            label="Category"
            htmlFor="category-trigger"
            hint="Where it shows up when people browse."
          >
            <CategorySelect
              id="category-trigger"
              value={category}
              onValueChange={setCategory}
            />
          </Field>
          <Field
            label="Tags"
            htmlFor="tags"
            optional
            hint="Comma separated. Helps search."
          >
            <Input id="tags" name="tags" placeholder="desk, cable, clip" />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Sharing">
        <VisibilityField value={visibility} onChange={setVisibility} />
        <LicenseField
          id="license-trigger"
          value={license}
          onChange={setLicense}
        />
        <SaleField
          id="sell-toggle"
          enabled={sellEnabled}
          onEnabledChange={setSellEnabled}
        >
          <Field
            label="Price"
            htmlFor="price"
            hint="USD. Set 0 to make it free."
            className="max-w-[12rem]"
          >
            <PriceInput
              id="price"
              name="price"
              max={MAX_PRICE_CENTS / 100}
              defaultValue="0"
            />
          </Field>
        </SaleField>
      </FormSection>

      <FormSection title="Organize">
        <div
          className={cn(
            "grid min-w-0 gap-5",
            userProjects.length > 0 && "sm:grid-cols-2",
          )}
        >
          <Field label="Collection" htmlFor="collection-trigger" optional>
            <Select
              value={collectionChoice}
              onValueChange={(v) => v && setCollectionChoice(v)}
            >
              <SelectTrigger id="collection-trigger" className="w-full">
                <SelectValue>
                  {(value) => {
                    if (!value || value === "none") return "None";
                    if (value === "__new__") return "New collection…";
                    const found = userCollections.find((c) => c.id === value);
                    return found?.name ?? "None";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {userCollections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
                <SelectItem value="__new__">New collection…</SelectItem>
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
                  <div className="pt-2">
                    <Input
                      value={newCollectionName}
                      onChange={(e) => setNewCollectionName(e.target.value)}
                      placeholder="Collection name"
                      aria-label="New collection name"
                      autoFocus
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Field>

          {userProjects.length > 0 && (
            <Field
              label="Project"
              htmlFor="project-trigger"
              optional
              hint="Bundle it into a set you sell together."
            >
              <Select
                value={projectChoice}
                onValueChange={(v) => v && setProjectChoice(v)}
              >
                <SelectTrigger id="project-trigger" className="w-full">
                  <SelectValue>
                    {(value) => {
                      if (!value || value === "none") return "None";
                      const found = userProjects.find((p) => p.id === value);
                      return found?.name ?? "None";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {userProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
      </FormSection>

      {/* Print recommendations — optional, collapsed by default. A
          disclosure row rather than a card that is secretly a button. */}
      <section className="flex min-w-0 flex-col">
        <button
          type="button"
          onClick={() => setPrintRecOpen((v) => !v)}
          aria-expanded={printRecOpen}
          aria-controls="print-recs"
          className="-mx-3 flex cursor-pointer items-center justify-between gap-4 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="min-w-0">
            <span className="block text-base leading-6 font-semibold">
              Printing
            </span>
            <span className="block text-[13px] leading-[18px] text-muted-foreground">
              Optional. Suggest a material so buyers order the right print.
            </span>
          </span>
          <motion.span
            animate={{ rotate: printRecOpen ? 180 : 0 }}
            transition={expandTransition}
            className="text-muted-foreground"
          >
            <ChevronDownIcon />
          </motion.span>
        </button>
        <AnimatePresence initial={false}>
          {printRecOpen && (
            <motion.div
              id="print-recs"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={expandTransition}
              className="overflow-hidden"
            >
              <div className="flex flex-col gap-5 pt-4">
                <Field label="Recommended material" htmlFor="material-trigger">
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
                </Field>

                <DesignTagChips
                  selected={selectedDesignTags}
                  onToggle={toggleDesignTag}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <div className="flex flex-col gap-3">
        <FormError>{submitError}</FormError>
        <FormActions>
          {onCancel ? (
            <Button
              type="button"
              variant="secondary"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              render={<Link href="/" />}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" loading={isSubmitting}>
            {submitLabel}
          </Button>
        </FormActions>
      </div>
      {duplicateMatch && (
        <DuplicateUploadDialog
          match={duplicateMatch}
          onClose={() => setDuplicateMatch(null)}
        />
      )}
    </form>
  );
}
