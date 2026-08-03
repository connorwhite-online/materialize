import { z } from "zod";
import { LICENSE_ENUM_VALUES } from "@/lib/licenses";
import { CATEGORY_IDS } from "@/lib/categories";
import { isHttpUrl, HTTP_URL_SCHEME_MESSAGE } from "@/lib/validations/url";

/**
 * Optional curated browse category. Empty string (from a "None"
 * select) or an unknown/stale slug both resolve to undefined rather
 * than failing the whole form — categories are a soft classification,
 * never a hard gate on publishing.
 */
export const categorySchema = z.enum(CATEGORY_IDS).optional().catch(undefined);

export const ACCEPTED_FORMATS = [
  "stl",
  "obj",
  "3mf",
  "step",
  "amf",
] as const;

export const ACCEPTED_MIME_TYPES: Record<string, string> = {
  stl: "model/stl",
  obj: "model/obj",
  "3mf": "model/3mf",
  step: "model/step",
  amf: "model/amf",
};

export const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

// Same ceiling and rationale as lib/validations/project.ts's
// MAX_PRICE_CENTS: Stripe maxes line items at 999, well below this;
// cents math caps at ~$21M for a 32-bit signed int, so $1M is a sane
// upper bound. Defined locally rather than imported from project.ts —
// project.ts already imports DESIGN_TAG_OPTIONS/categorySchema FROM
// this file, so importing MAX_PRICE_CENTS back from project.ts would
// create a file.ts <-> project.ts circular import (risky: whichever
// module starts evaluating first would read the other's export before
// it's initialized).
export const MAX_PRICE_CENTS = 100_000_000;

export const fileExtensionToFormat = (filename: string) => {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "stp") return "step";
  if (ext && ACCEPTED_FORMATS.includes(ext as (typeof ACCEPTED_FORMATS)[number])) {
    return ext as (typeof ACCEPTED_FORMATS)[number];
  }
  return null;
};

export const DESIGN_TAG_OPTIONS = [
  "strong",
  "flexible",
  "heat-resistant",
  "watertight",
  "detailed",
  "lightweight",
] as const;

// Keyed loosely as Record<string, string> so callers indexing with a
// raw `string` from a tag column don't need to narrow first; the
// `|| tag` fallback at every call site handles unknown tags.
export const DESIGN_TAG_LABELS: Record<string, string> = {
  strong: "Strong",
  flexible: "Flexible",
  "heat-resistant": "Heat Resistant",
  watertight: "Watertight",
  detailed: "Detailed",
  lightweight: "Lightweight",
};

export const createListingSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(5000).optional(),
  price: z.coerce
    .number()
    .min(0, "Price must be 0 or more")
    .max(MAX_PRICE_CENTS / 100, `Price must be under $${MAX_PRICE_CENTS / 100}`)
    .transform((val) => Math.round(val * 100)), // dollars to cents
  license: z.enum(LICENSE_ENUM_VALUES),
  visibility: z.enum(["public", "private"]).optional(),
  tags: z
    .string()
    .optional()
    .transform((val) =>
      val
        ? val
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : []
    ),
  category: categorySchema,
  recommendedMaterialId: z.string().optional(),
  recommendedCcMaterialId: z.string().optional(),
  recommendedCcFinishGroupId: z.string().optional(),
  designTags: z.array(z.enum(DESIGN_TAG_OPTIONS)).optional(),
  minWallThickness: z.coerce
    .number()
    .min(0)
    .max(100)
    .optional()
    .transform((val) => (val ? Math.round(val * 10) : undefined)), // mm to 0.1mm units
});

export const updateListingSchema = createListingSchema.partial();

export const profileSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Username can only contain letters, numbers, underscores, and hyphens"
    ),
  displayName: z.string().max(100).optional(),
  bio: z.string().max(500).optional(),
});

export const socialLinkSchema = z.object({
  platform: z.string(),
  // SEC-B1 — rendered raw into href= on the public profile
  // (components/profile/user-profile-view.tsx); a bare z.string().url()
  // accepts `javascript:` URIs, which is a stored-XSS primitive. Pin
  // to http(s) only, mirroring bomItemSchema.sourceUrl.
  url: z.string().url("Must be a valid URL").refine(isHttpUrl, HTTP_URL_SCHEME_MESSAGE),
});

export const socialLinksSchema = z.array(socialLinkSchema).max(6);
