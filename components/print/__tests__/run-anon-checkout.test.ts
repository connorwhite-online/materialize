import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the server actions the chain calls. Each test swaps the
// underlying implementation via the closure holders below.
let draftImpl: (p: unknown) => Promise<unknown> = async () => ({
  fileAssetId: "asset-1",
  fileSlug: "slug-1",
});
let createOrderImpl: (p: unknown) => Promise<unknown> = async () => ({
  orderId: "order-1",
  cartId: "cart-1",
});
let completeOrderImpl: (p: unknown) => Promise<unknown> = async () => ({
  checkoutUrl: "https://stripe.example/session-1",
});

vi.mock("@/app/actions/files", () => ({
  createDraftFileForPrint: (p: unknown) => draftImpl(p),
}));

vi.mock("@/app/actions/print", () => ({
  createPrintOrder: (p: unknown) => createOrderImpl(p),
  completePrintOrder: (p: unknown) => completeOrderImpl(p),
}));

import { runAnonCheckout, type AnonCheckoutInput } from "../run-anon-checkout";

function makeFile(): File {
  return new File(["hello world"], "carabiner.stl", {
    type: "application/octet-stream",
  });
}

const baseInput: AnonCheckoutInput = {
  file: makeFile(),
  selectedQuote: {
    quoteId: "q-1",
    vendorId: "v-1",
    materialConfigId: "mc-1",
    price: 19.99,
    currency: "USD",
  },
  selectedShipping: {
    shippingId: "ship-1",
    price: 5.0,
  },
  quantity: 1,
  addressData: {
    email: "ada@example.com",
    shipping: {
      firstName: "Ada",
      lastName: "Lovelace",
      address: "123 Main",
      city: "London",
      zipCode: "NW15LR",
      countryCode: "GB",
    },
    billing: {
      firstName: "Ada",
      lastName: "Lovelace",
      address: "123 Main",
      city: "London",
      zipCode: "NW15LR",
      countryCode: "GB",
      isCompany: false,
    },
  },
};

function mockPresignAndPut(opts?: {
  presignStatus?: number;
  presignBody?: unknown;
  putStatus?: number;
}) {
  const presignStatus = opts?.presignStatus ?? 200;
  const putStatus = opts?.putStatus ?? 200;
  const presignBody = opts?.presignBody ?? {
    uploadUrl: "https://r2.example/upload-url",
    storageKey: "uploads/test-user-id/abc/carabiner.stl",
    format: "stl",
  };

  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const href = typeof url === "string" ? url : (url as Request).url;
    if (href.includes("/api/upload/presign")) {
      return new Response(JSON.stringify(presignBody), {
        status: presignStatus,
        headers: { "content-type": "application/json" },
      });
    }
    // R2 PUT
    return new Response(null, { status: putStatus });
  });
}

describe("runAnonCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // reset happy-path defaults
    draftImpl = async () => ({ fileAssetId: "asset-1", fileSlug: "slug-1" });
    createOrderImpl = async () => ({ orderId: "order-1", cartId: "cart-1" });
    completeOrderImpl = async () => ({
      checkoutUrl: "https://stripe.example/session-1",
    });
  });

  it("walks the full chain on the happy path and returns the Stripe url", async () => {
    mockPresignAndPut();
    const result = await runAnonCheckout(baseInput);
    expect(result).toEqual({
      ok: true,
      checkoutUrl: "https://stripe.example/session-1",
    });
  });

  it("returns the presign error when the presign route 4xx/5xxs", async () => {
    mockPresignAndPut({
      presignStatus: 400,
      presignBody: { error: "File exceeds 200MB limit" },
    });
    const result = await runAnonCheckout(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("File exceeds 200MB limit");
    }
  });

  it("returns a generic error when the R2 PUT fails", async () => {
    mockPresignAndPut({ putStatus: 403 });
    const result = await runAnonCheckout(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/R2 upload failed/);
    }
  });

  it("propagates the createDraftFileForPrint content-hash duplicate error", async () => {
    mockPresignAndPut();
    draftImpl = async () => ({
      error:
        "This file has already been listed by another creator. Re-uploading others' files is not permitted.",
    });
    const result = await runAnonCheckout(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/already been listed/);
    }
  });

  it("propagates createPrintOrder errors", async () => {
    mockPresignAndPut();
    createOrderImpl = async () => ({ error: "Invalid order parameters" });
    const result = await runAnonCheckout(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Invalid order parameters");
    }
  });

  it("propagates completePrintOrder errors (no Stripe redirect)", async () => {
    mockPresignAndPut();
    completeOrderImpl = async () => ({
      error: "Payment provider returned no checkout URL.",
    });
    const result = await runAnonCheckout(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Payment provider/);
    }
  });

  it("never throws — unexpected errors inside the chain are returned as ok:false", async () => {
    mockPresignAndPut();
    createOrderImpl = async () => {
      throw new Error("database unreachable");
    };
    const result = await runAnonCheckout(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("database unreachable");
    }
  });

  it("passes the correct payloads to each downstream call", async () => {
    mockPresignAndPut();
    const draftSpy = vi.fn(async () => ({
      fileAssetId: "asset-1",
      fileSlug: "slug-1",
    }));
    const orderSpy = vi.fn(async () => ({
      orderId: "order-1",
      cartId: "cart-1",
    }));
    const completeSpy = vi.fn(async () => ({
      checkoutUrl: "https://stripe.example/session-1",
    }));
    draftImpl = draftSpy;
    createOrderImpl = orderSpy;
    completeOrderImpl = completeSpy;

    await runAnonCheckout(baseInput);

    expect(draftSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        storageKey: "uploads/test-user-id/abc/carabiner.stl",
        originalFilename: "carabiner.stl",
        format: "stl",
      })
    );

    expect(orderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fileAssetId: "asset-1",
        quoteId: "q-1",
        vendorId: "v-1",
        materialConfigId: "mc-1",
        shippingId: "ship-1",
        quantity: 1,
        materialPrice: 19.99,
        shippingPrice: 5.0,
      })
    );

    expect(completeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        email: "ada@example.com",
        isAnonFlow: true,
      })
    );
  });
});
