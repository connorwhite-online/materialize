import { beforeEach, describe, expect, it, vi } from "vitest";

const createCart = vi.fn();
vi.mock("../client", () => ({ createCart: (...a: unknown[]) => createCart(...a) }));

import {
  clearVendorMinimumCache,
  getVendorMinimums,
  MAX_PROBES_PER_REQUEST,
} from "../vendor-minimums";

const probe = (vendorId: string) => ({ vendorId, quoteId: `q-${vendorId}`, shippingId: `s-${vendorId}` });

beforeEach(() => {
  clearVendorMinimumCache();
  createCart.mockReset();
});

describe("getVendorMinimums", () => {
  it("reads the minimum off a cart; a null minimum means none", async () => {
    createCart.mockImplementation(async (req: { quotes: { id: string }[] }) => {
      const vendor = req.quotes[0].id.slice(2);
      return {
        minimumProductionPrice: {
          [vendor]: vendor === "panashape"
            ? { price: 33, productionFee: 25.73 }
            : { price: null, productionFee: 0 },
        },
      };
    });
    const out = await getVendorMinimums([probe("panashape"), probe("jawstec")], "USD");
    expect(out).toEqual({ panashape: 33, jawstec: 0 });
  });

  it("caches per currency and vendor", async () => {
    createCart.mockResolvedValue({ minimumProductionPrice: { a: { price: 10, productionFee: 0 } } });
    await getVendorMinimums([probe("a")], "USD");
    await getVendorMinimums([probe("a"), probe("a")], "USD");
    expect(createCart).toHaveBeenCalledTimes(1);
    await getVendorMinimums([probe("a")], "EUR");
    expect(createCart).toHaveBeenCalledTimes(2);
  });

  it("leaves failed vendors out instead of caching a wrong zero", async () => {
    createCart.mockRejectedValueOnce(new Error("stale quote"));
    expect(await getVendorMinimums([probe("a")], "USD")).toEqual({});
    createCart.mockResolvedValueOnce({ minimumProductionPrice: { a: { price: 5, productionFee: 0 } } });
    expect(await getVendorMinimums([probe("a")], "USD")).toEqual({ a: 5 });
  });

  it("caps the carts one request can create", async () => {
    createCart.mockResolvedValue({});
    const probes = Array.from({ length: MAX_PROBES_PER_REQUEST + 10 }, (_, i) => probe(`v${i}`));
    await getVendorMinimums(probes, "USD");
    expect(createCart).toHaveBeenCalledTimes(MAX_PROBES_PER_REQUEST);
  });
});
