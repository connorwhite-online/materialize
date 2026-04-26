import { z } from "zod";
import { DESIGN_TAG_OPTIONS } from "./file";

export const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(5000).optional(),
  price: z.coerce
    .number()
    .min(0, "Price must be 0 or more")
    .transform((val) => Math.round(val * 100)),
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
  designTags: z.array(z.enum(DESIGN_TAG_OPTIONS)).optional(),
  thumbnailUrl: z.string().url().optional(),
  fileIds: z.array(z.string().uuid()).min(1, "At least one file is required"),
});

export const updateProjectSchema = createProjectSchema
  .partial()
  .omit({ fileIds: true });
