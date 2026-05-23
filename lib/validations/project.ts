import { z } from "zod";
import { DESIGN_TAG_OPTIONS } from "./file";
import { LICENSE_ENUM_VALUES } from "@/lib/licenses";

// Hard ceilings — pasted JSON, scripted requests, or a runaway loop
// shouldn't be able to push thousands of file IDs or tags into a
// single project row. The numbers are way above any plausible
// legitimate value.
export const MAX_PROJECT_FILES = 50;
export const MAX_PROJECT_TAGS = 20;
export const MAX_TAG_LENGTH = 32;
// The build guide is long-form documentation (steps, photos, code
// snippets) so it gets a far larger ceiling than the description's
// 5000. Still bounded so a runaway paste can't write an unbounded row.
export const MAX_BUILD_GUIDE_LENGTH = 50_000;
// Stripe maxes line items at 999, well below this. Cents math caps
// at ~$21M for a 32-bit signed int — ceiling at $1M as a sanity bound.
export const MAX_PRICE_CENTS = 100_000_000;

export const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(200),
  description: z
    .string()
    .max(5000)
    .optional()
    .transform((val) => (val ? val.trim() || undefined : undefined)),
  // Long-form markdown build guide. Empty/whitespace resolves to
  // undefined so the column stays NULL rather than holding "".
  buildGuide: z
    .string()
    .max(MAX_BUILD_GUIDE_LENGTH)
    .optional()
    .transform((val) => (val ? val.trim() || undefined : undefined)),
  price: z.coerce
    .number()
    .min(0, "Price must be 0 or more")
    .max(MAX_PRICE_CENTS / 100, `Price must be under $${MAX_PRICE_CENTS / 100}`)
    .transform((val) => Math.round(val * 100)),
  license: z.enum(LICENSE_ENUM_VALUES),
  visibility: z.enum(["public", "private"]).optional(),
  tags: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return [] as string[];
      const seen = new Set<string>();
      const out: string[] = [];
      for (const raw of val.split(",")) {
        const t = raw.trim().slice(0, MAX_TAG_LENGTH);
        if (!t) continue;
        const lower = t.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        out.push(t);
        if (out.length >= MAX_PROJECT_TAGS) break;
      }
      return out;
    }),
  designTags: z.array(z.enum(DESIGN_TAG_OPTIONS)).optional(),
  thumbnailUrl: z.string().url().optional(),
  // Optional pointer to the project's source code / firmware repo.
  // Empty string from a form should resolve to undefined so the
  // database column stays NULL rather than holding "".
  repoUrl: z
    .string()
    .trim()
    .url("Must be a valid URL")
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  fileIds: z
    .array(z.string().uuid())
    .min(1, "At least one file is required")
    .max(MAX_PROJECT_FILES, `A project can bundle at most ${MAX_PROJECT_FILES} files`)
    // Dedupe in-place so the project_files insert doesn't fail the
    // UNIQUE constraint when the caller submits the same id twice.
    .transform((ids) => Array.from(new Set(ids))),
});

export const updateProjectSchema = createProjectSchema
  .partial()
  .omit({ fileIds: true });
