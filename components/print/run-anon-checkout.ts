import { createDraftFileForPrint } from "@/app/actions/files";
import { createPrintOrder, completePrintOrder } from "@/app/actions/print";
import { uploadFileToR2 } from "@/components/upload/upload-file-to-r2";

/**
 * The anon-flow post-OTP checkout chain. Pure async function,
 * no React, no refs — the caller owns the in-flight guard and
 * the UI state transitions. Extracted from QuoteConfigurator so
 * it's independently testable and doesn't drown in the React
 * component's lifecycle.
 *
 * The chain:
 *   1-2. uploadFileToR2 (presign + R2 PUT, shared helper — MONEY-3)
 *   3. createDraftFileForPrint(storageKey) → fileAssetId
 *   4. createPrintOrder(...)               → orderId (+ CraftCloud cart)
 *   5. completePrintOrder(...)             → Stripe checkoutUrl
 *
 * Returns the Stripe checkoutUrl on success, or an Error-shaped
 * object on any failure. Never throws — the caller flips the
 * loading state based on the discriminant.
 */

export interface AnonCheckoutInput {
  file: File;
  selectedQuote: {
    // CraftCloud priceId the quoteId was resolved from — threaded so
    // createPrintOrder can re-derive the authoritative price via
    // getPrice() instead of trusting `price` below (MTR-130).
    priceId: string;
    quoteId: string;
    vendorId: string;
    vendorName?: string;
    materialConfigId: string;
    price: number;
    currency: string;
  };
  selectedShipping: {
    shippingId: string;
    price: number;
  };
  quantity: number;
  addressData: {
    email: string;
    shipping: {
      firstName: string;
      lastName: string;
      address: string;
      addressLine2?: string;
      city: string;
      zipCode: string;
      stateCode?: string;
      countryCode: string;
      companyName?: string;
      phoneNumber?: string;
    };
    billing: {
      firstName: string;
      lastName: string;
      address: string;
      addressLine2?: string;
      city: string;
      zipCode: string;
      stateCode?: string;
      countryCode: string;
      companyName?: string;
      phoneNumber?: string;
      isCompany: boolean;
      vatId?: string;
    };
  };
}

export type AnonCheckoutResult =
  | { ok: true; checkoutUrl: string }
  // Two-step first-timer: no redirect — the caller opens the embedded
  // fee sheet with this payload instead.
  | {
      ok: true;
      feeSheet: {
        clientSecret: string;
        orderId: string;
        amountCents: number;
        email?: string;
      };
    }
  | { ok: false; error: string };

export async function runAnonCheckout(
  input: AnonCheckoutInput
): Promise<AnonCheckoutResult> {
  try {
    // 1-2. Presign + PUT the file bytes to R2 (shared helper — MONEY-3).
    const uploaded = await uploadFileToR2({
      file: input.file,
      kind: "anon-print",
    });
    if ("error" in uploaded) return { ok: false, error: uploaded.error };
    const { storageKey, format: resolvedFormat } = uploaded;

    // 3. Create the draft file row + fileAsset linking the R2 key.
    const draft = await createDraftFileForPrint({
      storageKey,
      originalFilename: input.file.name,
      format: resolvedFormat,
      fileSize: input.file.size,
    });
    if ("error" in draft) return { ok: false, error: draft.error };

    // 4. Create the printOrder row + CraftCloud cart.
    const orderResult = await createPrintOrder({
      fileAssetId: draft.fileAssetId,
      priceId: input.selectedQuote.priceId,
      quoteId: input.selectedQuote.quoteId,
      vendorId: input.selectedQuote.vendorId,
      vendorName: input.selectedQuote.vendorName,
      materialConfigId: input.selectedQuote.materialConfigId,
      shippingId: input.selectedShipping.shippingId,
      quantity: input.quantity,
      materialPrice: input.selectedQuote.price,
      shippingPrice: input.selectedShipping.price,
      currency: input.selectedQuote.currency as "USD",
    });
    if ("error" in orderResult)
      return { ok: false, error: orderResult.error };

    // 5. Create the Stripe checkout session.
    const completeResult = await completePrintOrder({
      orderId: orderResult.orderId,
      email: input.addressData.email,
      shipping: input.addressData.shipping,
      billing: input.addressData.billing,
      isAnonFlow: true,
    });
    if ("error" in completeResult)
      return { ok: false, error: completeResult.error };

    if ("feeSheet" in completeResult) {
      return { ok: true, feeSheet: completeResult.feeSheet };
    }
    return { ok: true, checkoutUrl: completeResult.checkoutUrl };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Checkout failed",
    };
  }
}
