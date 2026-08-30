import { describe, it, expect, vi, beforeEach } from "vitest";

const insertedCollections: Array<Record<string, unknown>> = [];

vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        insertedCollections.push(vals);
        return {
          returning: () => [
            {
              id: "test-collection-id",
              slug: vals.slug,
              name: vals.name,
            },
          ],
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => [],
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  collections: { __name: "collections", id: "id", userId: "user_id" },
  collectionItems: { __name: "collection_items" },
  files: { __name: "files" },
  organizationMembers: { __name: "organization_members" },
  projects: { __name: "projects" },
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  isRedirectError: (e: unknown) =>
    e instanceof Error &&
    (e.message.includes("NEXT_REDIRECT") || e.message.includes("REDIRECT")),
}));

vi.mock("@/lib/authorization", () => ({
  resolveOwnerForCreate: vi.fn(async () => ({
    ok: true,
    organizationId: null,
  })),
  canWriteCollection: vi.fn(),
}));

vi.mock("nanoid", () => ({ nanoid: () => "abc123" }));

import { resolveOwnerForCreate } from "@/lib/authorization";
import { createCollection } from "../collections";

describe("createCollection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedCollections.length = 0;
    vi.mocked(resolveOwnerForCreate).mockResolvedValue({
      ok: true,
      organizationId: null,
    });
  });

  it("rejects an empty name without inserting", async () => {
    const formData = new FormData();
    formData.set("name", "");

    const result = await createCollection(formData);
    expect(result).toEqual({
      error: expect.objectContaining({ name: expect.any(Array) }),
    });
    expect(insertedCollections).toHaveLength(0);
  });

  it("rejects a requested org the viewer is not in", async () => {
    vi.mocked(resolveOwnerForCreate).mockResolvedValue({
      ok: false,
      reason: "forbidden",
    });

    const formData = new FormData();
    formData.set("name", "Desk accessories");
    formData.set("organizationId", "org-not-mine");

    const result = await createCollection(formData);
    expect(result).toEqual({
      error: { name: ["You're not a member of that organization."] },
    });
    expect(insertedCollections).toHaveLength(0);
  });

  it("inserts the row and redirects to the new collection page", async () => {
    const formData = new FormData();
    formData.set("name", "Desk accessories");
    formData.set("description", "Things for the desk");
    formData.set("visibility", "private");

    let threw: unknown;
    try {
      await createCollection(formData);
    } catch (err) {
      threw = err;
    }

    expect((threw as Error).message).toBe(
      "REDIRECT:/collections/desk-accessories-abc123"
    );
    expect(insertedCollections).toHaveLength(1);
    expect(insertedCollections[0]).toMatchObject({
      userId: "test-user-id",
      organizationId: null,
      name: "Desk accessories",
      description: "Things for the desk",
      visibility: "private",
      slug: "desk-accessories-abc123",
    });
  });
});
