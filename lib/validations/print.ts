import { z } from "zod";

const CURRENCIES = [
  "USD", "EUR", "GBP", "CAD", "AUD", "CHF", "NOK", "JPY", "ILS",
] as const;

const quotesCommonSchema = z.object({
  currency: z.enum(CURRENCIES).default("USD"),
  countryCode: z.string().length(2).default("US"),
  quantity: z.coerce.number().int().min(1).max(100).default(1),
  // Scope the CraftCloud price request to a specific material.
  // When present, the route expands it to the material's config
  // ids and passes them as materialConfigIds, which narrows the
  // vendor poll (fewer round-trips, much faster first paint).
  materialId: z.string().optional(),
});

// Two ways to ask for quotes:
//   1. `fileAssetId` — for files that already live in our DB (the
//      authed library / dashboard path). We look up the asset, check
//      ownership/visibility, then forward its CraftCloud modelId.
//   2. `modelId` — direct CraftCloud model id, used by the anon draft
//      flow where the file was uploaded straight to CraftCloud and
//      never persisted in our DB.
export const quotesRequestSchema = z.union([
  quotesCommonSchema.extend({ fileAssetId: z.string().uuid() }),
  quotesCommonSchema.extend({ modelId: z.string().min(1) }),
]);

export type QuotesRequest = z.infer<typeof quotesRequestSchema>;

export const printOrderSchema = z.object({
  fileAssetId: z.string().uuid(),
  quoteId: z.string().min(1),
  vendorId: z.string().min(1),
  materialConfigId: z.string().min(1),
  shippingId: z.string().min(1),
  quantity: z.number().int().min(1).max(100),
  materialPrice: z.number().positive(),
  shippingPrice: z.number().min(0),
  currency: z.enum(CURRENCIES),
});
