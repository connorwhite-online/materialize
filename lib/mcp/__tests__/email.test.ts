import { describe, it, expect, vi, beforeEach } from "vitest";

// Agent-order emails carry the confirm / cancel links, so they go to the
// account owner's own address — never to the agent-supplied shipping
// email, which an agent (or a prompt injected into one) controls.

const { state } = vi.hoisted(() => ({
  state: {
    user: null as null | {
      primaryEmailAddressId: string | null;
      emailAddresses: Array<{ id: string; emailAddress: string }>;
    },
    getUserError: null as Error | null,
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    users: {
      getUser: async () => {
        if (state.getUserError) throw state.getUserError;
        return state.user;
      },
    },
  }),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({
  fileAssets: {},
  files: {},
  personalAccessTokens: {},
  printOrders: {},
  tokenSpendingLedger: {},
}));
vi.mock("@/lib/craftcloud/catalog", () => ({
  findMaterialConfig: vi.fn(),
  findProvider: vi.fn(),
}));
vi.mock("@/lib/email/client", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { resolveAgentOrderRecipient } from "../email";

const ORDER = {
  userId: "user_owner",
  shippingAddress: { email: "agent-chosen@evil.example" },
};

beforeEach(() => {
  state.user = null;
  state.getUserError = null;
});

describe("resolveAgentOrderRecipient", () => {
  it("prefers the account owner's primary email over the shipping email", async () => {
    state.user = {
      primaryEmailAddressId: "em_2",
      emailAddresses: [
        { id: "em_1", emailAddress: "old@owner.example" },
        { id: "em_2", emailAddress: "primary@owner.example" },
      ],
    };
    expect(await resolveAgentOrderRecipient(ORDER)).toBe("primary@owner.example");
  });

  it("falls back to the shipping email when the account has no email", async () => {
    state.user = { primaryEmailAddressId: null, emailAddresses: [] };
    expect(await resolveAgentOrderRecipient(ORDER)).toBe(
      "agent-chosen@evil.example"
    );
  });

  it("falls back to the shipping email when the Clerk lookup fails", async () => {
    state.getUserError = new Error("clerk down");
    expect(await resolveAgentOrderRecipient(ORDER)).toBe(
      "agent-chosen@evil.example"
    );
  });

  it("returns null when neither is available", async () => {
    state.getUserError = new Error("clerk down");
    expect(
      await resolveAgentOrderRecipient({ userId: "u", shippingAddress: null })
    ).toBeNull();
  });
});
