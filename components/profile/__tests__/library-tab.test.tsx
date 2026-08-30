/**
 * Regression tests for MTR-239.
 *
 * `library-tab.tsx` used to filter project-bundled files out of
 * `ownedItems` BEFORE building the file-id lookup map used to resolve
 * collection membership. A file that was both in a collection AND
 * bundled in a project silently vanished from its collection section
 * (wrong count, "Empty collection" rendered) even though it really
 * belonged there. `resolveCollectionMembership` is the extracted pure
 * helper that fixes this: it resolves collection membership against
 * the FULL owned-item set, and only applies the project-bundled dedupe
 * to the standalone Files grid.
 */
import { describe, it, expect } from "vitest";
import { resolveCollectionMembership } from "../library-tab";
import type { LibraryFileCardItem } from "../library-file-card";

function makeItem(id: string): LibraryFileCardItem {
  return {
    id,
    name: `File ${id}`,
    slug: `file-${id}`,
    price: 0,
    visibility: "public",
    source: "owned",
    thumbnailUrl: null,
    additionalPhotoIds: [],
    primaryAssetId: null,
    primaryFormat: null,
  };
}

describe("resolveCollectionMembership", () => {
  it("includes a file that is both in a collection and bundled in a project", () => {
    const bundledAndCollected = makeItem("file-bundled-collected");
    const standalone = makeItem("file-standalone");
    const allOwnedItems = [bundledAndCollected, standalone];
    const collectionItemRows = [
      { collectionId: "col-1", fileId: "file-bundled-collected" },
    ];
    const fileIdsInOwnedProjects = new Set(["file-bundled-collected"]);

    const { itemsInCollection, standaloneOwnedItems } =
      resolveCollectionMembership(
        allOwnedItems,
        collectionItemRows,
        fileIdsInOwnedProjects
      );

    // The collection section must contain the bundled file — the bug
    // was that it silently dropped it because the lookup map only
    // contained non-bundled files.
    expect(itemsInCollection.get("col-1")).toEqual([bundledAndCollected]);
    expect(itemsInCollection.get("col-1")?.length).toBe(1);
  });

  it("excludes a project-bundled file (not in any collection) from the standalone Files grid", () => {
    const bundledOnly = makeItem("file-bundled-only");
    const standalone = makeItem("file-standalone");
    const allOwnedItems = [bundledOnly, standalone];
    const collectionItemRows: Array<{
      collectionId: string;
      fileId: string | null;
    }> = [];
    const fileIdsInOwnedProjects = new Set(["file-bundled-only"]);

    const { standaloneOwnedItems } = resolveCollectionMembership(
      allOwnedItems,
      collectionItemRows,
      fileIdsInOwnedProjects
    );

    expect(standaloneOwnedItems).toEqual([standalone]);
  });

  it("excludes a collected file (not bundled in a project) from the standalone grid too", () => {
    const collectedOnly = makeItem("file-collected-only");
    const standalone = makeItem("file-standalone");
    const allOwnedItems = [collectedOnly, standalone];
    const collectionItemRows = [
      { collectionId: "col-1", fileId: "file-collected-only" },
    ];
    const fileIdsInOwnedProjects = new Set<string>();

    const { standaloneOwnedItems, itemsInCollection } =
      resolveCollectionMembership(
        allOwnedItems,
        collectionItemRows,
        fileIdsInOwnedProjects
      );

    expect(standaloneOwnedItems).toEqual([standalone]);
    expect(itemsInCollection.get("col-1")).toEqual([collectedOnly]);
  });

  it("leaves a file in neither a project nor a collection in the standalone grid (no regression)", () => {
    const plain = makeItem("file-plain");
    const { standaloneOwnedItems } = resolveCollectionMembership(
      [plain],
      [],
      new Set()
    );
    expect(standaloneOwnedItems).toEqual([plain]);
  });
});
