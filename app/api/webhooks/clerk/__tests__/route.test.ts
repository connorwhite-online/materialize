/**
 * Tests for POST /api/webhooks/clerk (TEST-27, 2026-07-25 audit).
 *
 * This route had zero tests despite being the sole provisioning path for
 * users/organizations/memberships (including the hard user.deleted
 * cascade). Modeled on app/api/webhooks/stripe/__tests__/route.test.ts —
 * same "mock every collaborator, assert routing + DB calls" approach.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { WebhookEvent } from "@clerk/nextjs/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// next/headers is NOT pre-mocked by vitest.setup.ts. Default: all three
// svix headers present; individual tests null one out.
let mockHeaders: Record<string, string | null> = {
  "svix-id": "msg_1",
  "svix-timestamp": "1700000000",
  "svix-signature": "v1,valid",
};
vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({
      get: (name: string) => mockHeaders[name.toLowerCase()] ?? null,
    }),
}));

// svix's Webhook class: `.verify()` returns whatever we stage in
// nextEvent, or throws when signatureValid is false.
let nextEvent: WebhookEvent | null = null;
let signatureValid = true;
const mockVerify = vi.fn((..._args: unknown[]) => {
  if (!signatureValid) {
    throw new Error("Invalid signature");
  }
  return nextEvent;
});
vi.mock("svix", () => ({
  Webhook: class {
    verify(...args: unknown[]) {
      return mockVerify(...args);
    }
  },
}));

// DB: generic call-recording mock — this route only ever does
// insert(...).values(...).onConflictDoUpdate(...) or
// delete(...).where(...), never a select.
const mockInsert = vi.fn();
const mockInsertValues = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockDelete = vi.fn();
const mockDeleteWhere = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    insert: (table: unknown) => {
      mockInsert(table);
      return {
        values: (v: unknown) => {
          mockInsertValues(table, v);
          return {
            onConflictDoUpdate: (opts: unknown) => {
              mockOnConflictDoUpdate(table, opts);
              return Promise.resolve();
            },
          };
        },
      };
    },
    delete: (table: unknown) => {
      mockDelete(table);
      return {
        where: (w: unknown) => {
          mockDeleteWhere(table, w);
          return Promise.resolve();
        },
      };
    },
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { __name: "users", id: "id", updatedAt: "updated_at" },
  organizations: {
    __name: "organizations",
    id: "id",
    updatedAt: "updated_at",
  },
  organizationMembers: {
    __name: "organizationMembers",
    id: "id",
    organizationId: "organization_id",
    userId: "user_id",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  lt: (a: unknown, b: unknown) => ({ lt: [a, b] }),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...a: unknown[]) => mockLogError(...a),
}));

// lib/handles/validate does its own DB reads to check slug collisions —
// mocked at the boundary the route calls it, not re-derived from a fake
// DB. Default: no collision, keep the Clerk-provided slug verbatim.
let handleConflictReason: string | null = null;
const mockBuildUniqueHandle = vi.fn(
  async (stem: string, _opts?: unknown) => `${stem}-2`
);
vi.mock("@/lib/handles/validate", () => ({
  validateHandle: vi.fn(async () => handleConflictReason),
  buildUniqueHandle: (...a: [string, unknown]) => mockBuildUniqueHandle(...a),
}));

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OLD_SECRET = process.env.CLERK_WEBHOOK_SECRET;

function makeRequest(body: unknown = {}) {
  return new Request("https://example.com/api/webhooks/clerk", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function event(partial: {
  type: string;
  data: Record<string, unknown>;
}): WebhookEvent {
  return partial as unknown as WebhookEvent;
}

describe("POST /api/webhooks/clerk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders = {
      "svix-id": "msg_1",
      "svix-timestamp": "1700000000",
      "svix-signature": "v1,valid",
    };
    signatureValid = true;
    nextEvent = null;
    handleConflictReason = null;
    process.env.CLERK_WEBHOOK_SECRET = "whsec_clerk_test";
  });

  // -------------------------------------------------------------------------
  // Header / signature verification
  // -------------------------------------------------------------------------
  it("missing svix headers -> 400, verify never runs, no DB writes", async () => {
    mockHeaders["svix-signature"] = null;

    const res = await POST(makeRequest());

    expect(res.status).toBe(400);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("bad signature -> 400, no DB write", async () => {
    signatureValid = false;
    nextEvent = event({
      type: "user.created",
      data: {
        id: "user_1",
        username: "alice",
        first_name: "Alice",
        last_name: "A",
        image_url: null,
        has_image: false,
        updated_at: 1700000000000,
      },
    });

    const res = await POST(makeRequest({ some: "payload" }));

    expect(res.status).toBe(400);
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // user.created / user.updated
  // -------------------------------------------------------------------------
  it("user.created: upserts users with the expected onConflictDoUpdate set", async () => {
    nextEvent = event({
      type: "user.created",
      data: {
        id: "user_1",
        username: "alice",
        first_name: "Alice",
        last_name: "Anderson",
        image_url: "https://img/real.png",
        has_image: true,
        updated_at: 1700000000000,
      },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ __name: "users" }),
      expect.objectContaining({
        id: "user_1",
        username: "alice",
        displayName: "Alice Anderson",
        avatarUrl: "https://img/real.png",
      })
    );
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ __name: "users" }),
      expect.objectContaining({
        target: expect.anything(),
        set: expect.objectContaining({
          username: "alice",
          displayName: "Alice Anderson",
          avatarUrl: "https://img/real.png",
        }),
        setWhere: expect.anything(),
      })
    );
  });

  it("user.created: ignores Clerk's auto-generated placeholder avatar (has_image=false)", async () => {
    nextEvent = event({
      type: "user.created",
      data: {
        id: "user_1",
        username: "alice",
        first_name: "Alice",
        last_name: null,
        image_url: "https://img/placeholder.png",
        has_image: false,
        updated_at: 1700000000000,
      },
    });

    await POST(makeRequest());

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ __name: "users" }),
      expect.objectContaining({ avatarUrl: null })
    );
  });

  // -------------------------------------------------------------------------
  // user.deleted (hard cascade)
  // -------------------------------------------------------------------------
  it("user.deleted: hard-deletes the users row", async () => {
    nextEvent = event({
      type: "user.deleted",
      data: { id: "user_1" },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({ __name: "users" })
    );
    expect(mockDeleteWhere).toHaveBeenCalledWith(
      expect.objectContaining({ __name: "users" }),
      expect.anything()
    );
  });

  it("user.deleted: with no id in the payload, does not attempt a delete", async () => {
    nextEvent = event({
      type: "user.deleted",
      data: { id: undefined },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // organization.created / organization.deleted
  // -------------------------------------------------------------------------
  it("organization.created: mirrors into organizations with the Clerk slug when there's no collision", async () => {
    nextEvent = event({
      type: "organization.created",
      data: {
        id: "org_1",
        name: "Acme",
        slug: "acme",
        image_url: null,
        has_image: false,
        updated_at: 1700000000000,
      },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ __name: "organizations" }),
      expect.objectContaining({ id: "org_1", name: "Acme", slug: "acme" })
    );
    expect(mockBuildUniqueHandle).not.toHaveBeenCalled();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  // orgSlugCollision fallback (route.ts:108-117): Clerk is the source of
  // truth for the org's real slug, so on a local collision we mirror
  // under a suffixed slug instead of rejecting the write, and log it so
  // an admin can follow up.
  it("organization.created: on a slug collision, mirrors under the suffixed local slug and logs it", async () => {
    handleConflictReason = "Handle already taken by a user.";
    nextEvent = event({
      type: "organization.created",
      data: {
        id: "org_1",
        name: "Acme",
        slug: "acme",
        image_url: null,
        has_image: false,
        updated_at: 1700000000000,
      },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockBuildUniqueHandle).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ ignoreOrgId: "org_1" })
    );
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ __name: "organizations" }),
      expect.objectContaining({ slug: "acme-2" })
    );
    expect(mockLogError).toHaveBeenCalledWith(
      "clerkWebhook.orgSlugCollision",
      expect.objectContaining({
        orgId: "org_1",
        clerkSlug: "acme",
        localSlug: "acme-2",
        reason: handleConflictReason,
      })
    );
  });

  it("organization.deleted: hard-deletes the organizations row", async () => {
    nextEvent = event({
      type: "organization.deleted",
      data: { id: "org_1" },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({ __name: "organizations" })
    );
  });

  // -------------------------------------------------------------------------
  // organizationMembership.* — CON-80 out-of-order defense + membership CRUD
  // -------------------------------------------------------------------------
  it("organizationMembership.created: upserts the parent org defensively, then the membership row", async () => {
    nextEvent = event({
      type: "organizationMembership.created",
      data: {
        id: "mem_1",
        role: "org:admin",
        organization: {
          id: "org_1",
          name: "Acme",
          slug: "acme",
          has_image: false,
          image_url: null,
          updated_at: 1700000000000,
        },
        public_user_data: { user_id: "user_1" },
      },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    // Org upsert (defensive, in case org.created hasn't landed yet).
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ __name: "organizations" }),
      expect.objectContaining({ id: "org_1" })
    );
    // Membership upsert — role prefix stripped ("org:admin" -> "admin").
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ __name: "organizationMembers" }),
      expect.objectContaining({
        id: "mem_1",
        organizationId: "org_1",
        userId: "user_1",
        role: "admin",
      })
    );
  });

  it("organizationMembership.deleted: deletes by membership id AND falls back to the (org, user) pair", async () => {
    nextEvent = event({
      type: "organizationMembership.deleted",
      data: {
        id: "mem_1",
        organization: { id: "org_1" },
        public_user_data: { user_id: "user_1" },
      },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    // Two deletes fire: by stable Clerk membership id, then by the
    // (org, user) pair as a fallback for a reseeded-id replay.
    expect(mockDeleteWhere).toHaveBeenCalledTimes(2);
    expect(mockDeleteWhere.mock.calls[0][1]).toEqual({ eq: [expect.anything(), "mem_1"] });
    expect(mockDeleteWhere.mock.calls[1][1]).toEqual({
      and: [
        { eq: [expect.anything(), "org_1"] },
        { eq: [expect.anything(), "user_1"] },
      ],
    });
  });

  // -------------------------------------------------------------------------
  // Handler errors -> 500 (idempotent retry)
  // -------------------------------------------------------------------------
  it("a thrown handler error returns 500 and logs eventType, so Clerk retries", async () => {
    mockInsert.mockImplementationOnce(() => {
      throw new Error("db down");
    });
    nextEvent = event({
      type: "user.created",
      data: {
        id: "user_1",
        username: "alice",
        first_name: "Alice",
        last_name: "A",
        image_url: null,
        has_image: false,
        updated_at: 1700000000000,
      },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(mockLogError).toHaveBeenCalledWith(
      "clerkWebhook",
      expect.objectContaining({ eventType: "user.created" })
    );
  });

  it("an unrecognized event type is a 200 no-op — no DB writes", async () => {
    nextEvent = event({
      type: "session.created",
      data: { id: "sess_1" },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  process.env.CLERK_WEBHOOK_SECRET = OLD_SECRET;
});
