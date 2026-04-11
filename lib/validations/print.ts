import { z } from "zod";

const CURRENCIES = [
  "USD", "EUR", "GBP", "CAD", "AUD", "CHF", "NOK", "JPY", "ILS",
] as const;

export const quotesRequestSchema = z.object({
  fileAssetId: z.string().uuid(),
  currency: z.enum(CURRENCIES).default("USD"),
  countryCode: z.string().length(2).default("US"),
  quantity: z.coerce.number().int().min(1).max(100).default(1),
});

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
