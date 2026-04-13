import { z } from "zod";

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

export const createListingSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(5000).optional(),
  price: z.coerce
    .number()
    .min(0, "Price must be 0 or more")
    .transform((val) => Math.round(val * 100)), // dollars to cents
  license: z.enum(["free", "personal", "commercial"]),
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
  recommendedMaterialId: z.string().optional(),
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
  url: z.string().url("Must be a valid URL"),
});

export const socialLinksSchema = z.array(socialLinkSchema).max(6);
