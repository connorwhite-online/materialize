import { describe, it, expect, vi, beforeEach } from "vitest";

// getOrCreateStripeCustomer is the single source of the Stripe
// Customer both agent billing and the two_step fee checkout charge
// against. The invariants under test: an existing id is returned
// without touching Stripe, creation persists via a conditional
// fill-if-null write, and a lost race defers to the id the winner
// wrote (our freshly created customer becomes a harmless orphan).

// Reads consume from this queue (first read, then the re-read after a
// lost race). An empty queue yields no row.
let selectQueue: Array<Array<{ stripeCustomerId: string | null }>> = [];
// What the conditional UPDATE .returning() yields — [] = race lost.
let updateReturns: Array<{ stripeCustomerId: string | null }> = [];
const mockUpdateSet = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => selectQueue.shift() ?? [] }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values);
        return {
          where: () => ({ returning: () => updateReturns }),
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: {
    __name: "users",
    id: "id",
    stripeCustomerId: "stripe_customer_id",
  },
}));

const mockCustomersCreate = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    customers: {
      create: (...args: unknown[]) => mockCustomersCreate(...args),
    },
  }),
}));

import { getOrCreateStripeCustomer } from "../customers";

describe("getOrCreateStripeCustomer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue = [];
    updateReturns = [];
    mockCustomersCreate.mockResolvedValue({ id: "cus_new" });
  });

  it("returns the existing customer id without calling Stripe", async () => {
    selectQueue = [[{ stripeCustomerId: "cus_existing" }]];

    const id = await getOrCreateStripeCustomer("user-1");

    expect(id).toBe("cus_existing");
    expect(mockCustomersCreate).not.toHaveBeenCalled();
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("creates a customer tagged with the user id and persists it", async () => {
    selectQueue = [[{ stripeCustomerId: null }]];
    updateReturns = [{ stripeCustomerId: "cus_new" }];

    const id = await getOrCreateStripeCustomer("user-1", {
      email: "ada@example.com",
      name: "Ada Lovelace",
    });

    expect(id).toBe("cus_new");
    expect(mockCustomersCreate).toHaveBeenCalledWith({
      email: "ada@example.com",
      name: "Ada Lovelace",
      metadata: { materialize_user_id: "user-1" },
    });
    expect(mockUpdateSet).toHaveBeenCalledWith({
      stripeCustomerId: "cus_new",
    });
  });

  it("creates without contact details when none are given (no empty strings sent to Stripe)", async () => {
    selectQueue = [[]] as never; // no row at all
    updateReturns = [{ stripeCustomerId: "cus_new" }];

    const id = await getOrCreateStripeCustomer("user-1", {
      email: "",
      name: "",
    });

    expect(id).toBe("cus_new");
    expect(mockCustomersCreate).toHaveBeenCalledWith({
      email: undefined,
      name: undefined,
      metadata: { materialize_user_id: "user-1" },
    });
  });

  it("defers to the winner's id when the conditional write loses a race", async () => {
    selectQueue = [
      [{ stripeCustomerId: null }], // initial read: no customer yet
      [{ stripeCustomerId: "cus_winner" }], // re-read after lost write
    ];
    updateReturns = []; // fill-if-null matched zero rows

    const id = await getOrCreateStripeCustomer("user-1");

    expect(id).toBe("cus_winner");
  });

  it("falls back to its own created id if the re-read finds nothing", async () => {
    selectQueue = [[{ stripeCustomerId: null }], []];
    updateReturns = [];

    const id = await getOrCreateStripeCustomer("user-1");

    expect(id).toBe("cus_new");
  });
});
