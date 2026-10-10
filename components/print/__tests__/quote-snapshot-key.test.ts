import { describe, it, expect } from "vitest";
import { quoteSnapshotKey, type QuoteSnapshot } from "../poll-quotes";

function snap(
  quoteIds: string[],
  shippingIds: string[] = [],
  allComplete = false
): QuoteSnapshot {
  return {
    quotes: quoteIds.map((quoteId) => ({ quoteId })) as QuoteSnapshot["quotes"],
    shipping: shippingIds.map((shippingId) => ({
      shippingId,
      vendorId: "v",
      name: "Std",
      deliveryTime: 3,
      price: 5,
      type: "standard" as const,
    })),
    allComplete,
  };
}

describe("quoteSnapshotKey", () => {
  it("is equal for repeat snapshots (fresh arrays, same content)", () => {
    expect(quoteSnapshotKey(snap(["a", "b"], ["s1"]))).toBe(
      quoteSnapshotKey(snap(["a", "b"], ["s1"]))
    );
  });

  it("changes when a quote lands", () => {
    expect(quoteSnapshotKey(snap(["a"]))).not.toBe(
      quoteSnapshotKey(snap(["a", "b"]))
    );
  });

  it("changes when allComplete flips", () => {
    expect(quoteSnapshotKey(snap(["a"], [], false))).not.toBe(
      quoteSnapshotKey(snap(["a"], [], true))
    );
  });

  it("changes when shipping options change", () => {
    expect(quoteSnapshotKey(snap(["a"], ["s1"]))).not.toBe(
      quoteSnapshotKey(snap(["a"], ["s1", "s2"]))
    );
  });

  it("tolerates missing arrays", () => {
    expect(() =>
      quoteSnapshotKey({
        allComplete: true,
      } as unknown as QuoteSnapshot)
    ).not.toThrow();
  });
});
