import { describe, it, expect, vi, beforeEach } from "vitest";

type FileRow = { price: number; userId: string };
type ProjectRow = { price: number; userId: string };
type PurchaseRow = { id: string };
type AssetRow = { id: string };
type PrintOrderRow = { id: string };
type DownloadRow = { id: string };

const state: {
  fileRow: FileRow | null;
  projectRow: ProjectRow | null;
  directPurchase: PurchaseRow | null;
  projectPurchaseViaJoin: PurchaseRow | null;
  projectPurchase: PurchaseRow | null;
  fileDownload: DownloadRow | null;
  assets: AssetRow[];
  legacyPrintOrder: PrintOrderRow | null;
  multiItemPrintOrderItem: PrintOrderRow | null;
} = {
  fileRow: null,
  projectRow: null,
  directPurchase: null,
  projectPurchaseViaJoin: null,
  projectPurchase: null,
  fileDownload: null,
  assets: [],
  legacyPrintOrder: null,
  multiItemPrintOrderItem: null,
};

vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      // The chain returned depends on the next .from() call's table.
      return {
        from: (table: { __name?: string }) => {
          if (table.__name === "files") {
            return {
              where: () =>
                state.fileRow
                  ? [
                      {
                        price: state.fileRow.price,
                        userId: state.fileRow.userId,
                        organizationId: null,
                      },
                    ]
                  : [],
            };
          }
          if (table.__name === "projects") {
            return {
              where: () =>
                state.projectRow
                  ? [
                      {
                        price: state.projectRow.price,
                        userId: state.projectRow.userId,
                        organizationId: null,
                      },
                    ]
                  : [],
            };
          }
          if (table.__name === "organization_members") {
            return { where: () => ({ limit: () => [] }) };
          }
          if (table.__name === "project_collaborators") {
            // Both call shapes appear: bare where().limit() for the
            // project-direct lookup, and innerJoin().where().limit()
            // for the file-via-project-collab transitive read.
            return {
              where: () => ({ limit: () => [] }),
              innerJoin: () => ({ where: () => ({ limit: () => [] }) }),
            };
          }
          if (table.__name === "purchases") {
            // Two reads happen on purchases inside userOwnsFile:
            //   - direct purchase (no innerJoin)
            //   - via project purchase (innerJoin on projectFiles)
            // userOwnsProject only does the direct purchase path.
            return {
              where: () => ({
                limit: () =>
                  state.directPurchase ? [state.directPurchase] : [],
              }),
              innerJoin: () => ({
                where: () => ({
                  limit: () =>
                    state.projectPurchaseViaJoin
                      ? [state.projectPurchaseViaJoin]
                      : [],
                }),
              }),
            };
          }
          if (table.__name === "file_downloads") {
            return {
              where: () => ({
                limit: () =>
                  state.fileDownload ? [state.fileDownload] : [],
              }),
            };
          }
          if (table.__name === "file_assets") {
            return {
              where: () => state.assets,
            };
          }
          if (table.__name === "print_orders") {
            return {
              where: () => ({
                limit: () =>
                  state.legacyPrintOrder ? [state.legacyPrintOrder] : [],
              }),
            };
          }
          if (table.__name === "print_order_items") {
            return {
              innerJoin: () => ({
                where: () => ({
                  limit: () =>
                    state.multiItemPrintOrderItem
                      ? [state.multiItemPrintOrderItem]
                      : [],
                }),
              }),
            };
          }
          return { where: () => [] };
        },
      };
    },
  },
}));

vi.mock("@/lib/db/schema", () => ({
  files: { __name: "files", id: "id", price: "price", userId: "user_id" },
  projects: {
    __name: "projects",
    id: "id",
    price: "price",
    userId: "user_id",
  },
  projectFiles: {
    __name: "project_files",
    projectId: "project_id",
    fileId: "file_id",
  },
  projectCollaborators: {
    __name: "project_collaborators",
    id: "id",
    projectId: "project_id",
    userId: "user_id",
    role: "role",
  },
  organizationMembers: {
    __name: "organization_members",
    id: "id",
    organizationId: "organization_id",
    userId: "user_id",
    role: "role",
  },
  purchases: {
    __name: "purchases",
    id: "id",
    buyerId: "buyer_id",
    fileId: "file_id",
    projectId: "project_id",
    status: "status",
  },
  fileDownloads: {
    __name: "file_downloads",
    id: "id",
    fileId: "file_id",
    userId: "user_id",
  },
  fileAssets: { __name: "file_assets", id: "id", fileId: "file_id" },
  printOrders: {
    __name: "print_orders",
    id: "id",
    userId: "user_id",
    fileAssetId: "file_asset_id",
    status: "status",
  },
  printOrderItems: {
    __name: "print_order_items",
    id: "id",
    printOrderId: "print_order_id",
    fileAssetId: "file_asset_id",
  },
}));

import {
  userOwnsFile,
  userOwnsProject,
  userHasUsedFile,
} from "@/lib/entitlement";

describe("userOwnsFile", () => {
  beforeEach(() => {
    state.fileRow = null;
    state.projectRow = null;
    state.directPurchase = null;
    state.projectPurchaseViaJoin = null;
    state.projectPurchase = null;
  });

  it("returns false when the file doesn't exist", async () => {
    state.fileRow = null;
    expect(await userOwnsFile("u1", "missing")).toBe(false);
  });

  it("returns true for free files (any viewer, even anon)", async () => {
    state.fileRow = { price: 0, userId: "creator" };
    expect(await userOwnsFile(null, "f1")).toBe(true);
    expect(await userOwnsFile("u1", "f1")).toBe(true);
  });

  it("returns false for paid files when viewer is anonymous", async () => {
    state.fileRow = { price: 500, userId: "creator" };
    expect(await userOwnsFile(null, "f1")).toBe(false);
  });

  it("returns true when viewer is the file's creator", async () => {
    state.fileRow = { price: 500, userId: "u1" };
    expect(await userOwnsFile("u1", "f1")).toBe(true);
  });

  it("returns true via direct purchase", async () => {
    state.fileRow = { price: 500, userId: "creator" };
    state.directPurchase = { id: "p1" };
    expect(await userOwnsFile("u1", "f1")).toBe(true);
  });

  it("returns true via project purchase that includes the file", async () => {
    state.fileRow = { price: 500, userId: "creator" };
    state.directPurchase = null;
    state.projectPurchaseViaJoin = { id: "pp1" };
    expect(await userOwnsFile("u1", "f1")).toBe(true);
  });

  it("returns false when paid + not creator + no purchase + no project purchase", async () => {
    state.fileRow = { price: 500, userId: "creator" };
    state.directPurchase = null;
    state.projectPurchaseViaJoin = null;
    expect(await userOwnsFile("u1", "f1")).toBe(false);
  });
});

describe("userOwnsProject", () => {
  beforeEach(() => {
    state.fileRow = null;
    state.projectRow = null;
    state.directPurchase = null;
  });

  it("returns true for free projects", async () => {
    state.projectRow = { price: 0, userId: "creator" };
    expect(await userOwnsProject(null, "pr1")).toBe(true);
  });

  it("returns true for the project's creator", async () => {
    state.projectRow = { price: 1000, userId: "u1" };
    expect(await userOwnsProject("u1", "pr1")).toBe(true);
  });

  it("returns true with a completed purchase", async () => {
    state.projectRow = { price: 1000, userId: "creator" };
    state.directPurchase = { id: "purch1" };
    expect(await userOwnsProject("u1", "pr1")).toBe(true);
  });

  it("returns false otherwise", async () => {
    state.projectRow = { price: 1000, userId: "creator" };
    state.directPurchase = null;
    expect(await userOwnsProject("u1", "pr1")).toBe(false);
  });
});

describe("userHasUsedFile", () => {
  beforeEach(() => {
    state.fileDownload = null;
    state.assets = [];
    state.legacyPrintOrder = null;
    state.multiItemPrintOrderItem = null;
  });

  it("returns false for anonymous viewers without hitting the DB", async () => {
    expect(await userHasUsedFile(null, "f1")).toBe(false);
  });

  it("returns false when signed in but no download / no print", async () => {
    state.fileDownload = null;
    state.assets = [{ id: "a1" }];
    state.legacyPrintOrder = null;
    state.multiItemPrintOrderItem = null;
    expect(await userHasUsedFile("u1", "f1")).toBe(false);
  });

  it("returns true when the user has a fileDownloads row", async () => {
    state.fileDownload = { id: "d1" };
    expect(await userHasUsedFile("u1", "f1")).toBe(true);
  });

  it("returns true via legacy single-item printOrders.fileAssetId", async () => {
    state.fileDownload = null;
    state.assets = [{ id: "a1" }];
    state.legacyPrintOrder = { id: "po1" };
    expect(await userHasUsedFile("u1", "f1")).toBe(true);
  });

  it("returns true via multi-item printOrderItems.fileAssetId", async () => {
    state.fileDownload = null;
    state.assets = [{ id: "a1" }];
    state.legacyPrintOrder = null;
    state.multiItemPrintOrderItem = { id: "poi1" };
    expect(await userHasUsedFile("u1", "f1")).toBe(true);
  });

  it("returns false when the file has no assets and no download row", async () => {
    state.fileDownload = null;
    state.assets = [];
    expect(await userHasUsedFile("u1", "f1")).toBe(false);
  });
});
