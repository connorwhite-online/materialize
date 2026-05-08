import { z } from "zod";

// Per-row caps. 50 items matches MAX_PROJECT_FILES so a single project's
// "stuff you need" surface stays bounded by one screenful.
export const MAX_BOM_ITEMS = 50;
export const MAX_BOM_NAME_LENGTH = 200;
export const MAX_BOM_UNIT_LENGTH = 20;
export const MAX_BOM_NOTES_LENGTH = 500;
export const MAX_BOM_URL_LENGTH = 2048;
// Quantity ceiling — well above realistic BOM sizes, but rejects
// nonsense like "1e9 screws". Numeric column has 3 decimals so 0.001
// is the smallest representable value.
export const MAX_BOM_QUANTITY = 100_000;

export const bomItemSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(MAX_BOM_NAME_LENGTH),
  quantity: z.coerce
    .number()
    .positive("Quantity must be greater than 0")
    .max(MAX_BOM_QUANTITY, `Quantity must be ≤ ${MAX_BOM_QUANTITY}`),
  unit: z
    .string()
    .trim()
    .max(MAX_BOM_UNIT_LENGTH)
    .optional()
    .transform((v) => (v ? v : undefined)),
  notes: z
    .string()
    .trim()
    .max(MAX_BOM_NOTES_LENGTH)
    .optional()
    .transform((v) => (v ? v : undefined)),
  // Source URL is optional. We require https:// when supplied — http://
  // links from a build guide get downgraded by the browser anyway, and
  // we don't want to render them prominently.
  sourceUrl: z
    .string()
    .trim()
    .max(MAX_BOM_URL_LENGTH)
    .url("Must be a valid URL")
    .refine((u) => u.startsWith("https://"), "Must use https://")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const replaceBomSchema = z.array(bomItemSchema).max(MAX_BOM_ITEMS);

export type BomItemInput = z.infer<typeof bomItemSchema>;
