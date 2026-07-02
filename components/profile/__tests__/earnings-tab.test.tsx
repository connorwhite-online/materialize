// @vitest-environment jsdom
/**
 * Regression test for MTR-137: the Earnings tab's "Prints" stat joined
 * printOrders.fileAssetId / printOrderItems.fileAssetId directly onto
 * files.id — two independent UUID spaces (fileAssetId is a FK to
 * fileAssets.id) that essentially never match, so the stat always
 * reported ~0 regardless of real print volume.
 *
 * This test locks in two things:
 *   1. Structurally: the printOrders / printOrderItems count queries no
 *      longer innerJoin to `files` at all — the fix resolves the
 *      creator's fileAssets.id set first (via a dedicated fileAssets
 *      query) and filters printOrders/printOrderItems.fileAssetId
 *      against that set instead.
 *   2. Behaviorally: with a nonzero "print orders" + "print order
 *      items" count from the (mocked) DB, the rendered "Prints" stat
 *      reflects their sum, not 0.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

type Call = { table: string; chain: string[] };
let calls: Call[] = [];
let tableResults: Record<string, unknown[]> = {};

function nameOf(table: { __name?: string }) {
  return table.__name ?? "unknown";
}

// A minimal chainable query-builder stand-in. It's a *real* Promise
// (so `swallow()`'s `p.catch(...)` works) with drizzle's chain methods
// bolted on, each recording what was called and returning the same
// promise so further chaining / awaiting both work. Resolves to
// `tableResults[<primary from() table>]`, ignoring join targets and
// where-clause predicates — this test only needs to assert *which*
// tables a query touches, not evaluate the SQL it would produce.
function makeChain(tableName: string) {
  const record: Call = { table: tableName, chain: [] };
  calls.push(record);
  const promise = Promise.resolve(tableResults[tableName] ?? []) as Promise<unknown[]> &
    Record<string, unknown>;
  promise.where = (..._args: unknown[]) => {
    record.chain.push("where");
    return promise;
  };
  promise.innerJoin = (joinTable: { __name?: string }) => {
    record.chain.push(`innerJoin:${nameOf(joinTable)}`);
    return promise;
  };
  promise.leftJoin = (joinTable: { __name?: string }) => {
    record.chain.push(`leftJoin:${nameOf(joinTable)}`);
    return promise;
  };
  promise.orderBy = (..._args: unknown[]) => {
    record.chain.push("orderBy");
    return promise;
  };
  promise.limit = (..._args: unknown[]) => {
    record.chain.push("limit");
    return promise;
  };
  return promise;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => makeChain(nameOf(table)),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { __name: "users", id: "id", stripeOnboardingComplete: "stripeOnboardingComplete" },
  files: { __name: "files", id: "id", userId: "userId", slug: "slug", name: "name" },
  fileAssets: { __name: "fileAssets", id: "id", fileId: "fileId" },
  fileComments: { __name: "fileComments", fileId: "fileId", deletedAt: "deletedAt" },
  fileDownloads: { __name: "fileDownloads", fileId: "fileId" },
  filePhotos: { __name: "filePhotos", fileId: "fileId", kind: "kind" },
  printOrderItems: {
    __name: "printOrderItems",
    id: "id",
    printOrderId: "printOrderId",
    fileAssetId: "fileAssetId",
  },
  printOrders: {
    __name: "printOrders",
    id: "id",
    fileAssetId: "fileAssetId",
    status: "status",
  },
  projectComments: { __name: "projectComments", projectId: "projectId", deletedAt: "deletedAt" },
  projects: { __name: "projects", id: "id", userId: "userId", slug: "slug", name: "name" },
  purchases: {
    __name: "purchases",
    id: "id",
    creatorPayout: "creatorPayout",
    status: "status",
    createdAt: "createdAt",
    fileId: "fileId",
    projectId: "projectId",
  },
}));

import { EarningsTab } from "../earnings-tab";

const USER_ID = "creator-1";

beforeEach(() => {
  calls = [];
  tableResults = {
    users: [{ id: USER_ID, stripeOnboardingComplete: true }],
    files: [{ id: "file-1" }],
    projects: [],
    fileAssets: [{ id: "asset-1" }, { id: "asset-2" }],
    purchases: [],
    fileDownloads: [{ value: 0 }],
    printOrders: [{ value: 3 }],
    printOrderItems: [{ value: 4 }],
    fileComments: [{ value: 0 }],
    projectComments: [{ value: 0 }],
    filePhotos: [{ value: 0 }],
  };
});

describe("EarningsTab prints stat (MTR-137)", () => {
  it("resolves the creator's fileAssets.id set and filters print counts on it, not files.id", async () => {
    render(await EarningsTab({ userId: USER_ID }));

    const fileAssetsCall = calls.find((c) => c.table === "fileAssets");
    expect(fileAssetsCall).toBeDefined();

    const printOrdersCall = calls.find((c) => c.table === "printOrders");
    expect(printOrdersCall).toBeDefined();
    expect(printOrdersCall!.chain).not.toContain("innerJoin:files");

    const printOrderItemsCall = calls.find((c) => c.table === "printOrderItems");
    expect(printOrderItemsCall).toBeDefined();
    expect(printOrderItemsCall!.chain).toContain("innerJoin:printOrders");
    expect(printOrderItemsCall!.chain).not.toContain("innerJoin:files");
  });

  it("renders the sum of both print-count queries as the Prints stat instead of 0", async () => {
    render(await EarningsTab({ userId: USER_ID }));

    // printOrders (3) + printOrderItems (4) = 7. Before the fix both
    // queries always returned 0 regardless of mocked counts, because
    // the join predicate (fileAssetId === files.id) never matched.
    expect(screen.getByText("Prints")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
  });
});
