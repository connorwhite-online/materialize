import { describe, it, expect, vi, beforeEach } from "vitest";
import { clerkClient } from "@clerk/nextjs/server";
import { setMockUserId } from "@/vitest.setup";

const inserted: { table: string; values: Record<string, unknown> }[] = [];
let storedSlug: string | undefined;
vi.mock("@/lib/db", () => ({
  db: {
    insert: (table: { __name: string }) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          inserted.push({ table: table.__name, values });
        },
      }),
    }),
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => (storedSlug ? [{ slug: storedSlug }] : []) }) }),
    }),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  organizations: { __name: "organizations", id: "id", slug: "slug" },
  organizationMembers: { __name: "organization_members", id: "id" },
}));
const validateHandle = vi.fn();
const buildUniqueHandle = vi.fn();
vi.mock("@/lib/handles/validate", () => ({
  validateHandle: (...a: unknown[]) => validateHandle(...a),
  buildUniqueHandle: (...a: unknown[]) => buildUniqueHandle(...a),
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { finishOrganizationCreate, suggestOrganizationSlug } from "../organizations";

const membership = (userId: string) => ({
  id: "orgmem_1",
  role: "org:admin",
  publicUserData: { userId },
  organization: {
    id: "org_1",
    name: "Pneuma",
    slug: "pneuma",
    hasImage: false,
    imageUrl: "https://img.clerk.com/x",
    updatedAt: 1700000000000,
  },
});

function clerkWith(memberUserId: string) {
  vi.mocked(clerkClient).mockResolvedValueOnce({
    organizations: {
      getOrganizationMembershipList: vi.fn(async () => ({ data: [membership(memberUserId)] })),
    },
  } as never);
}

beforeEach(() => {
  inserted.length = 0;
  storedSlug = undefined;
  validateHandle.mockReset().mockResolvedValue(null);
  buildUniqueHandle.mockReset().mockImplementation(async (s: string) => s);
  setMockUserId("user_1");
});

describe("suggestOrganizationSlug", () => {
  it("returns a handle that's free in our namespace", async () => {
    buildUniqueHandle.mockResolvedValueOnce("pneuma-robotics-2");
    expect(await suggestOrganizationSlug("Pneuma Robotics")).toEqual({ slug: "pneuma-robotics-2" });
    expect(buildUniqueHandle).toHaveBeenCalledWith("pneuma-robotics");
  });

  it("requires sign-in", async () => {
    setMockUserId(null);
    expect(await suggestOrganizationSlug("Pneuma")).toHaveProperty("error");
  });

  it("rejects a name with nothing to slug", async () => {
    expect(await suggestOrganizationSlug("!!!")).toHaveProperty("error");
    expect(buildUniqueHandle).not.toHaveBeenCalled();
  });
});

describe("finishOrganizationCreate", () => {
  it("mirrors the org and the creator's membership, then returns the stored slug", async () => {
    clerkWith("user_1");
    storedSlug = "pneuma";
    expect(await finishOrganizationCreate("org_1")).toEqual({ slug: "pneuma" });
    expect(inserted).toEqual([
      { table: "organizations", values: expect.objectContaining({ id: "org_1", slug: "pneuma", imageUrl: null }) },
      { table: "organization_members", values: { id: "orgmem_1", organizationId: "org_1", userId: "user_1", role: "admin" } },
    ]);
  });

  it("refuses an org the caller isn't a member of", async () => {
    clerkWith("someone_else");
    expect(await finishOrganizationCreate("org_1")).toEqual({ error: "Organization not found." });
    expect(inserted).toEqual([]);
  });

  it("uses a suffixed local slug when Clerk's collides with a handle", async () => {
    clerkWith("user_1");
    validateHandle.mockResolvedValueOnce("That handle is already taken.");
    buildUniqueHandle.mockResolvedValueOnce("pneuma-2");
    expect(await finishOrganizationCreate("org_1")).toEqual({ slug: "pneuma-2" });
  });
});
