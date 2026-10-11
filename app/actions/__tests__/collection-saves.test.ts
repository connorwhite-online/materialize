import { describe, it, expect, vi, beforeEach } from "vitest";
import { setMockUserId } from "@/vitest.setup";

// A chainable stand-in for drizzle: every builder call returns the same
// chain, and awaiting it yields the next queued result for that op.
const selects: unknown[][] = [];
const inserted: Array<Record<string, unknown>> = [];
const ops: string[] = [];

function chain(op: string): unknown {
  const target = {} as Record<string, unknown>;
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") {
        const result =
          op === "select"
            ? (selects.shift() ?? [])
            : op === "insert-returning"
              ? [{ id: "col_new", name: "Desk toys", slug: "desk-toys-abc123", organizationId: null }]
              : [];
        return (resolve: (v: unknown) => void) => resolve(result);
      }
      return (arg: unknown) => {
        if (prop === "values") inserted.push(arg as Record<string, unknown>);
        if (prop === "returning") return chain("insert-returning");
        return chain(op);
      };
    },
  });
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      ops.push("select");
      return chain("select");
    },
    insert: () => {
      ops.push("insert");
      return chain("insert");
    },
    update: () => {
      ops.push("update");
      return chain("update");
    },
    delete: () => {
      ops.push("delete");
      return chain("delete");
    },
  },
}));

vi.mock("@/lib/db/schema", () => ({
  collections: { id: "id", name: "name", slug: "slug", organizationId: "org", updatedAt: "u", userId: "user" },
  collectionItems: { id: "id", collectionId: "cid", fileId: "fid", projectId: "pid", sortOrder: "so" },
  files: { id: "id", status: "status", visibility: "visibility" },
  projects: { id: "id", status: "status", visibility: "visibility" },
  organizationMembers: { organizationId: "org", userId: "user" },
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("nanoid", () => ({ nanoid: () => "abc123" }));

vi.mock("@/lib/authorization", () => ({
  canWriteCollection: vi.fn(),
  canWriteFile: vi.fn(),
  canWriteProject: vi.fn(),
}));

vi.mock("@/lib/collections/saved", () => ({
  writableCollectionIds: vi.fn(async () => "writable"),
  itemMatches: vi.fn(() => "matches"),
}));

import { canWriteCollection, canWriteFile } from "@/lib/authorization";
import {
  createCollectionWithItem,
  listSaveOptions,
  setCollectionSaved,
} from "../collection-saves";

const file = { kind: "file" as const, id: "file_1" };

beforeEach(() => {
  vi.clearAllMocks();
  selects.length = 0;
  inserted.length = 0;
  ops.length = 0;
  setMockUserId("user_me");
  vi.mocked(canWriteCollection).mockResolvedValue({
    ok: true,
    resource: { id: "col_1", slug: "desk-toys" },
    viaOrg: false,
  } as never);
});

describe("listSaveOptions", () => {
  it("marks the collections that already hold the item", async () => {
    selects.push(
      [
        { id: "col_1", name: "Desk toys", slug: "desk-toys", organizationId: null },
        { id: "col_2", name: "Gifts", slug: "gifts", organizationId: null },
      ],
      [{ collectionId: "col_2" }]
    );
    const res = await listSaveOptions(file);
    expect(res).toEqual({
      collections: [
        expect.objectContaining({ id: "col_1", saved: false }),
        expect.objectContaining({ id: "col_2", saved: true }),
      ],
    });
  });

  it("asks signed-out viewers to sign in", async () => {
    setMockUserId(null);
    expect(await listSaveOptions(file)).toEqual({ error: "Sign in to save." });
  });
});

describe("setCollectionSaved", () => {
  it("saves someone else's published public file", async () => {
    selects.push(
      [{ status: "published", visibility: "public" }], // the file
      [], // not already in the collection
      [{ sortOrder: 0 }, { sortOrder: 4 }] // existing order
    );
    expect(await setCollectionSaved("col_1", file, true)).toEqual({ saved: true });
    expect(inserted).toEqual([
      { collectionId: "col_1", sortOrder: 5, fileId: "file_1" },
    ]);
    expect(canWriteFile).not.toHaveBeenCalled();
  });

  it("doesn't add the same item twice", async () => {
    selects.push(
      [{ status: "published", visibility: "public" }],
      [{ id: "item_1" }]
    );
    expect(await setCollectionSaved("col_1", file, true)).toEqual({ saved: true });
    expect(inserted).toEqual([]);
  });

  it("refuses someone else's private file", async () => {
    selects.push([{ status: "published", visibility: "private" }]);
    vi.mocked(canWriteFile).mockResolvedValue({ ok: false, reason: "forbidden" });
    expect(await setCollectionSaved("col_1", file, true)).toEqual({
      error: "Can't save this.",
    });
    expect(ops).not.toContain("insert");
  });

  it("refuses a collection the viewer can't write", async () => {
    vi.mocked(canWriteCollection).mockResolvedValue({ ok: false, reason: "forbidden" } as never);
    expect(await setCollectionSaved("col_x", file, true)).toEqual({
      error: "Collection not found.",
    });
    expect(ops).not.toContain("insert");
  });

  it("removes the item when unsaving", async () => {
    expect(await setCollectionSaved("col_1", file, false)).toEqual({ saved: false });
    expect(ops).toContain("delete");
    expect(ops).not.toContain("insert");
  });

  it("rejects a malformed target", async () => {
    expect(
      await setCollectionSaved("col_1", { kind: "user", id: "x" } as never, true)
    ).toEqual({ error: "Nothing to save." });
  });
});

describe("createCollectionWithItem", () => {
  it("starts a personal collection with the item in it", async () => {
    selects.push(
      [{ status: "published", visibility: "public" }],
      [], // not already there
      [] // empty collection
    );
    const res = await createCollectionWithItem("  Desk toys ", file);
    expect(res).toEqual({
      collection: expect.objectContaining({ id: "col_new", saved: true }),
    });
    expect(inserted[0]).toEqual({
      userId: "user_me",
      name: "Desk toys",
      slug: "desk-toys-abc123",
    });
    expect(inserted[1]).toEqual({
      collectionId: "col_new",
      sortOrder: 0,
      fileId: "file_1",
    });
  });

  it("needs a name", async () => {
    expect(await createCollectionWithItem("   ", file)).toEqual({
      error: "Name the collection.",
    });
    expect(ops).toEqual([]);
  });
});
