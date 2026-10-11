import { beforeEach, describe, expect, it, vi } from "vitest";

// Every db query resolves to the next queued result, whatever its
// builder chain looks like — these tests pin decisions, not SQL.
const selectQueue: unknown[][] = [];
const inserted: Record<string, unknown>[] = [];
const updates: Record<string, unknown>[] = [];

function chain(result: () => unknown) {
  const node: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "limit", "orderBy"]) {
    node[m] = () => node;
  }
  node.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve().then(result).then(resolve, reject);
  return node;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => chain(() => selectQueue.shift() ?? []),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return { returning: async () => [{ id: "purchase-1", stripeTransferId: null }] };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        return { where: async () => [] };
      },
    }),
  },
}));

const ownsLoadedFile = vi.fn();
vi.mock("@/lib/entitlement", () => ({
  ownsLoadedFile: (...args: unknown[]) => ownsLoadedFile(...args),
}));

const logError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logError(...args),
}));

const notifyPurchaseOnListing = vi.fn();
vi.mock("@/lib/notifications/notify", () => ({
  notifyPurchaseOnListing: (...args: unknown[]) => notifyPurchaseOnListing(...args),
}));

const stripe = {
  paymentIntents: { retrieve: vi.fn() },
  checkout: { sessions: { retrieve: vi.fn() } },
  transfers: { create: vi.fn(), createReversal: vi.fn() },
};
vi.mock("@/lib/stripe", () => ({ getStripe: () => stripe }));

import {
  LICENSE_PAYOUTS_DISABLED_ERROR,
  buildLicenseLineItems,
  grantPrintLicenses,
  licenseSplit,
  resolvePrintLicense,
  revokePrintLicenses,
} from "../license";

const paidFile = {
  fileId: "file-1",
  fileName: "Gearbox",
  price: 500,
  ownerId: "creator-1",
  organizationId: null,
  stripeAccountId: "acct_1",
  stripeOnboardingComplete: true,
};

beforeEach(() => {
  selectQueue.length = 0;
  inserted.length = 0;
  updates.length = 0;
  vi.clearAllMocks();
  ownsLoadedFile.mockResolvedValue(false);
});

describe("resolvePrintLicense", () => {
  it("is free for a free file", async () => {
    selectQueue.push([{ ...paidFile, price: 0 }]);
    expect(await resolvePrintLicense("buyer-1", "asset-1")).toEqual({
      ok: true,
      license: null,
    });
    expect(ownsLoadedFile).not.toHaveBeenCalled();
  });

  it("is free when the buyer already owns the file", async () => {
    selectQueue.push([paidFile]);
    ownsLoadedFile.mockResolvedValue(true);
    expect(await resolvePrintLicense("buyer-1", "asset-1")).toEqual({
      ok: true,
      license: null,
    });
  });

  it("charges the price once for a paid file the buyer doesn't own", async () => {
    selectQueue.push([paidFile], []);
    expect(await resolvePrintLicense("buyer-1", "asset-1")).toEqual({
      ok: true,
      license: { fileId: "file-1", fileName: "Gearbox", licenseCents: 500 },
    });
  });

  it("doesn't charge again while another order already paid for it", async () => {
    selectQueue.push([paidFile], [{ id: "order-0" }]);
    expect(await resolvePrintLicense("buyer-1", "asset-1")).toEqual({
      ok: true,
      license: null,
    });
  });

  it("prices it for a signed-out visitor without an in-flight lookup", async () => {
    selectQueue.push([paidFile]);
    const result = await resolvePrintLicense(null, "asset-1");
    expect(result).toEqual({
      ok: true,
      license: { fileId: "file-1", fileName: "Gearbox", licenseCents: 500 },
    });
    expect(selectQueue).toHaveLength(0);
  });

  it("refuses when the creator can't be paid", async () => {
    selectQueue.push([{ ...paidFile, stripeOnboardingComplete: false }], []);
    expect(await resolvePrintLicense("buyer-1", "asset-1")).toEqual({
      ok: false,
      error: LICENSE_PAYOUTS_DISABLED_ERROR,
    });
  });
});

describe("licenseSplit", () => {
  it("keeps the same 3% a direct sale keeps", () => {
    expect(licenseSplit(1000)).toEqual({ serviceFee: 30, creatorPayout: 970 });
  });
});

describe("buildLicenseLineItems", () => {
  it("adds nothing when the order licenses nothing", async () => {
    expect(
      await buildLicenseLineItems({ id: "o", fileAssetId: "a", licenseFee: 0 })
    ).toEqual([]);
  });

  it("adds one line per licensed file, quantity 1", async () => {
    selectQueue.push([{ fileName: "Gearbox", licenseFee: 500 }]);
    const lines = await buildLicenseLineItems({
      id: "o",
      fileAssetId: "a",
      licenseFee: 500,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: 500,
        product_data: { name: "File — Gearbox" },
      },
    });
  });
});

describe("grantPrintLicenses", () => {
  function queueGrant({ existingPurchase }: { existingPurchase?: object } = {}) {
    selectQueue.push(
      [{ userId: "buyer-1", licenseFee: 500, fileAssetId: "asset-1" }], // order
      [{ fileId: "file-1" }], // asset → file
      [{ name: "Gearbox", slug: "gearbox", ownerId: "creator-1", stripeAccountId: "acct_1" }],
      existingPurchase ? [existingPurchase] : [],
      [{ id: "buyer-1", username: "b", displayName: null, avatarUrl: null }]
    );
  }

  it("records the purchase, pays the creator from the order's charge, and notifies", async () => {
    queueGrant();
    stripe.paymentIntents.retrieve.mockResolvedValue({ latest_charge: "ch_1" });
    stripe.transfers.create.mockResolvedValue({ id: "tr_1" });

    await grantPrintLicenses("order-1", "pi_1");

    expect(inserted[0]).toMatchObject({
      buyerId: "buyer-1",
      fileId: "file-1",
      amount: 500,
      serviceFee: 15,
      creatorPayout: 485,
      printOrderId: "order-1",
      status: "completed",
    });
    expect(inserted[0]).not.toHaveProperty("stripePaymentIntentId");
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 485,
        destination: "acct_1",
        source_transaction: "ch_1",
      }),
      { idempotencyKey: "print-license-transfer:order-1:file-1" }
    );
    expect(updates).toContainEqual({ stripeTransferId: "tr_1" });
    expect(notifyPurchaseOnListing).toHaveBeenCalledOnce();
  });

  it("is a no-op on a repeat once the purchase and transfer exist", async () => {
    queueGrant({ existingPurchase: { id: "purchase-1", stripeTransferId: "tr_1" } });
    stripe.paymentIntents.retrieve.mockResolvedValue({ latest_charge: "ch_1" });

    await grantPrintLicenses("order-1", "pi_1");

    expect(inserted).toHaveLength(0);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(notifyPurchaseOnListing).not.toHaveBeenCalled();
  });

  it("still grants the file when the payout transfer fails, and logs it", async () => {
    queueGrant();
    stripe.paymentIntents.retrieve.mockResolvedValue({ latest_charge: "ch_1" });
    stripe.transfers.create.mockRejectedValue(new Error("insufficient funds"));

    await expect(grantPrintLicenses("order-1", "pi_1")).resolves.toBeUndefined();

    expect(inserted).toHaveLength(1);
    expect(logError).toHaveBeenCalledWith(
      "printLicense.transfer",
      expect.objectContaining({ orderId: "order-1", creatorPayout: 485 })
    );
  });

  it("finds the charge through the Checkout session when no intent is given", async () => {
    selectQueue.push(
      [{ userId: "buyer-1", licenseFee: 500, fileAssetId: "asset-1" }],
      [{ fileId: "file-1" }],
      [{ stripeSessionId: "cs_1", feePaymentIntentId: null }],
      [{ name: "Gearbox", slug: "gearbox", ownerId: "creator-1", stripeAccountId: "acct_1" }],
      [],
      []
    );
    stripe.checkout.sessions.retrieve.mockResolvedValue({ payment_intent: "pi_9" });
    stripe.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { id: "ch_9" } });
    stripe.transfers.create.mockResolvedValue({ id: "tr_9" });

    await grantPrintLicenses("order-1", null);

    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_9");
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({ source_transaction: "ch_9" }),
      expect.anything()
    );
  });

  it("does nothing for an order with no license", async () => {
    selectQueue.push([{ userId: "buyer-1", licenseFee: 0, fileAssetId: "asset-1" }]);
    await grantPrintLicenses("order-1", "pi_1");
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });
});

describe("revokePrintLicenses", () => {
  it("reverses the transfer and marks the purchase refunded", async () => {
    selectQueue.push([{ id: "purchase-1", stripeTransferId: "tr_1" }]);
    await revokePrintLicenses("order-1");
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_1",
      {},
      { idempotencyKey: "print-license-reversal:purchase-1" }
    );
    expect(updates).toContainEqual({ status: "refunded" });
  });

  it("still revokes ownership when the reversal fails", async () => {
    selectQueue.push([{ id: "purchase-1", stripeTransferId: "tr_1" }]);
    stripe.transfers.createReversal.mockRejectedValue(new Error("already reversed"));
    await revokePrintLicenses("order-1");
    expect(updates).toContainEqual({ status: "refunded" });
    expect(logError).toHaveBeenCalledWith("printLicense.reversal", expect.anything());
  });
});
