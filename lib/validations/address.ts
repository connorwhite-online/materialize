import { z } from "zod";

export const addressSchema = z.object({
  firstName: z.string().min(1, "Required").max(128),
  lastName: z.string().min(1, "Required").max(128),
  address: z.string().min(1, "Required").max(128),
  addressLine2: z.string().max(128).optional(),
  city: z.string().min(1, "Required").max(128),
  zipCode: z.string().min(1, "Required").max(16),
  stateCode: z.string().max(8).optional(),
  countryCode: z.string().length(2, "Required"),
  companyName: z.string().max(200).optional(),
  phoneNumber: z.string().max(20).optional(),
});

export const checkoutAddressSchema = z.object({
  email: z.string().email("Valid email required"),
  shipping: addressSchema,
  billingSameAsShipping: z.boolean().default(true),
  billing: addressSchema
    .extend({
      isCompany: z.boolean().default(false),
      vatId: z.string().optional(),
    })
    .optional(),
});

export type CheckoutAddress = z.infer<typeof checkoutAddressSchema>;
