import { createDraftFileForPrint } from "@/app/actions/files";
import { createPrintOrder, completePrintOrder } from "@/app/actions/print";

/**
 * The anon-flow post-OTP checkout chain. Pure async function,
 * no React, no refs — the caller owns the in-flight guard and
 * the UI state transitions. Extracted from QuoteConfigurator so
 * it's independently testable and doesn't drown in the React
 * component's lifecycle.
 *
 * The chain:
 *   1. POST /api/upload/presign            → uploadUrl, storageKey
 *   2. PUT to R2 via the presign URL
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
  | { ok: false; error: string };

export async function runAnonCheckout(
  input: AnonCheckoutInput
): Promise<AnonCheckoutResult> {
  try {
    // 1. Presign a new R2 upload URL for this file.
    const presignRes = await fetch("/api/upload/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: input.file.name,
        contentType: "application/octet-stream",
        fileSize: input.file.size,
      }),
    });
    if (!presignRes.ok) {
      const data = await presignRes.json().catch(() => ({}));
      return {
        ok: false,
        error: data.error || `Upload presign failed (${presignRes.status})`,
      };
    }
    const {
      uploadUrl,
      storageKey,
      format: resolvedFormat,
    } = (await presignRes.json()) as {
      uploadUrl: string;
      storageKey: string;
      format: "stl" | "obj" | "3mf" | "step" | "amf";
    };

    // 2. PUT the file bytes to R2.
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: input.file,
    });
    if (!putRes.ok) {
      return { ok: false, error: `R2 upload failed (${putRes.status})` };
    }

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

    return { ok: true, checkoutUrl: completeResult.checkoutUrl };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Checkout failed",
    };
  }
}
