import { describe, it, expect, vi, beforeEach } from "vitest";

// discardDraftOrder deletes a cart_created row — but cart_created does
// not mean nothing happened yet. These pin the guards: a placed
// CraftCloud order, a pi_ charge or a mid-flight claim are never
// deleted, and a Checkout session is expired (or found paid) first.

let selectedOrder: Record<string, unknown> | null = null;
const deleteWhere = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => (selectedOrder ? [selectedOrder] : []),
      }),
    }),
    delete: () => ({
      where: (w: unknown) => {
        deleteWhere(w);
        return Promise.resolve();
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  printOrders: {
    __name: "printOrders",
    id: "id",
    userId: "user_id",
    status: "status",
    stripeSessionId: "stripe_session_id",
    craftCloudOrderId: "craft_cloud_order_id",
  },
}));

const sessionRetrieve = vi.fn();
const sessionExpire = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        retrieve: (...a: unknown[]) => sessionRetrieve(...a),
        expire: (...a: unknown[]) => sessionExpire(...a),
      },
    },
  }),
}));

vi.mock("@/lib/craftcloud/client", () => ({
  CraftCloudApiError: class extends Error {},
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  isRedirectError: () => false,
}));

import { discardDraftOrder } from "../print";

const draft = {
  id: "order-1",
  status: "cart_created",
  stripeSessionId: null as string | null,
  craftCloudOrderId: null as string | null,
};

describe("discardDraftOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectedOrder = { ...draft };
    sessionRetrieve.mockResolvedValue({ status: "open" });
    sessionExpire.mockResolvedValue({ status: "expired" });
  });

  it("deletes a pristine draft without touching Stripe", async () => {
    const res = await discardDraftOrder("order-1");

    expect(res).toEqual({ success: true });
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(sessionRetrieve).not.toHaveBeenCalled();
  });

  it("refuses an order that has already moved past cart_created", async () => {
    selectedOrder = { ...draft, status: "ordered" };

    const res = await discardDraftOrder("order-1");

    expect(res).toHaveProperty("error");
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it.each([
    ["a real CraftCloud order (two_step places up-front)", "cc-order-1"],
    ["a webhook placing: sentinel", "placing:abc"],
  ])("refuses when craftCloudOrderId is set — %s", async (_label, ccId) => {
    selectedOrder = { ...draft, craftCloudOrderId: ccId };

    const res = await discardDraftOrder("order-1");

    expect(res).toHaveProperty("error");
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("refuses a pi_ payment ref — money already moved", async () => {
    selectedOrder = { ...draft, stripeSessionId: "pi_charged" };

    const res = await discardDraftOrder("order-1");

    expect(res).toHaveProperty("error");
    expect(sessionRetrieve).not.toHaveBeenCalled();
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("refuses while a session_claim: sentinel is held", async () => {
    selectedOrder = { ...draft, stripeSessionId: "session_claim:xyz" };

    const res = await discardDraftOrder("order-1");

    expect(res).toHaveProperty("error");
    expect(sessionRetrieve).not.toHaveBeenCalled();
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("expires an open Checkout session before deleting", async () => {
    selectedOrder = { ...draft, stripeSessionId: "cs_open" };

    const res = await discardDraftOrder("order-1");

    expect(res).toEqual({ success: true });
    expect(sessionExpire).toHaveBeenCalledWith("cs_open");
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("tolerates an already-expired session", async () => {
    selectedOrder = { ...draft, stripeSessionId: "cs_old" };
    sessionRetrieve.mockResolvedValue({ status: "expired" });

    const res = await discardDraftOrder("order-1");

    expect(res).toEqual({ success: true });
    expect(sessionExpire).not.toHaveBeenCalled();
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("refuses when the session is already complete (paid, webhook pending)", async () => {
    selectedOrder = { ...draft, stripeSessionId: "cs_paid" };
    sessionRetrieve.mockResolvedValue({ status: "complete" });

    const res = await discardDraftOrder("order-1");

    expect(res).toHaveProperty("error");
    expect(sessionExpire).not.toHaveBeenCalled();
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("refuses when the buyer completes checkout between the read and the expire", async () => {
    selectedOrder = { ...draft, stripeSessionId: "cs_race" };
    sessionRetrieve
      .mockResolvedValueOnce({ status: "open" })
      .mockResolvedValueOnce({ status: "complete" });
    sessionExpire.mockRejectedValue(new Error("not open"));

    const res = await discardDraftOrder("order-1");

    expect(res).toHaveProperty("error");
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("refuses (rather than deleting blind) when Stripe can't be reached", async () => {
    selectedOrder = { ...draft, stripeSessionId: "cs_unknown" };
    sessionRetrieve.mockRejectedValue(new Error("stripe down"));

    const res = await discardDraftOrder("order-1");

    expect(res).toHaveProperty("error");
    expect(deleteWhere).not.toHaveBeenCalled();
  });
});
