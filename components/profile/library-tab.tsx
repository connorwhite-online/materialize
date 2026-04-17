import { db } from "@/lib/db";
import {
  files,
  fileAssets,
  collections,
  collectionFiles,
  purchases,
  users,
} from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { CollectionSection } from "./collection-section";
import {
  LibraryFileCard,
  type LibraryFileCardItem,
} from "./library-file-card";
import { NewCollectionButton } from "./new-collection-button";
import { UploadDialog } from "@/components/upload/upload-dialog";

interface LibraryTabProps {
  userId: string;
  isOwner: boolean;
}

type LibraryItem = LibraryFileCardItem;

// Cap owned + purchased file fetches at a user-friendly ceiling.
// Picked so a prolific creator still gets a full working view while
// pathological accounts (10k+ uploads) can't DoS the tab by joining
// every asset row. Real pagination is a future refactor; a truncation
// notice flags the cap to the user so nothing silently disappears.
const LIBRARY_MAX_FILES = 500;

export async function LibraryTab({ userId, isOwner }: LibraryTabProps) {
  // Owned files (creator content)
  const fileConditions = [eq(files.userId, userId)];
  if (!isOwner) {
    fileConditions.push(eq(files.status, "published"));
    fileConditions.push(eq(files.visibility, "public"));
  }
  // Fetch one extra so we can tell if the library was truncated
  // without a second count() query.
  const ownedFilesRaw = await db
    .select()
    .from(files)
    .where(and(...fileConditions))
    .orderBy(desc(files.createdAt))
    .limit(LIBRARY_MAX_FILES + 1);
  const ownedTruncated = ownedFilesRaw.length > LIBRARY_MAX_FILES;
  const ownedFiles = ownedTruncated
    ? ownedFilesRaw.slice(0, LIBRARY_MAX_FILES)
    : ownedFilesRaw;

  // Purchased files (buyer content) — owner only, since purchases are private
  type PurchasedRow = {
    id: string;
    name: string;
    slug: string;
    price: number;
    visibility: string;
    thumbnailUrl: string | null;
    creatorUsername: string | null;
    creatorDisplayName: string | null;
  };
  let purchasedRows: PurchasedRow[] = [];
  let purchasedTruncated = false;
  if (isOwner) {
    const rawPurchased = await db
      .select({
        id: files.id,
        name: files.name,
        slug: files.slug,
        price: files.price,
        visibility: files.visibility,
        thumbnailUrl: files.thumbnailUrl,
        creatorUsername: users.username,
        creatorDisplayName: users.displayName,
      })
      .from(purchases)
      .innerJoin(files, eq(purchases.fileId, files.id))
      .innerJoin(users, eq(files.userId, users.id))
      .where(
        and(
          eq(purchases.buyerId, userId),
          eq(purchases.status, "completed")
        )
      )
      .limit(LIBRARY_MAX_FILES + 1);
    purchasedTruncated = rawPurchased.length > LIBRARY_MAX_FILES;
    purchasedRows = purchasedTruncated
      ? rawPurchased.slice(0, LIBRARY_MAX_FILES)
      : rawPurchased;
  }

  const allFileIds = [
    ...ownedFiles.map((f) => f.id),
    ...purchasedRows.map((r) => r.id),
  ];
  const primaryAssetByFileId = new Map<
    string,
    {
      id: string;
      format: string;
      dimensions: [number, number, number] | null;
    }
  >();
  if (allFileIds.length > 0) {
    const assetRows = await db
      .select({
        id: fileAssets.id,
        fileId: fileAssets.fileId,
        format: fileAssets.format,
        geometryData: fileAssets.geometryData,
        createdAt: fileAssets.createdAt,
      })
      .from(fileAssets)
      .where(inArray(fileAssets.fileId, allFileIds))
      .orderBy(fileAssets.createdAt);
    for (const asset of assetRows) {
      if (!asset.fileId) continue;
      if (!primaryAssetByFileId.has(asset.fileId)) {
        const dims = asset.geometryData?.dimensions;
        // Older CraftCloud responses sometimes returned partial shapes
        // (e.g. {x: null, y: null, z: null}) that we persisted before
        // the normalize at the cache boundary; treat anything missing
        // a numeric axis as no dimensions at all.
        const dimsOk =
          dims &&
          typeof dims.x === "number" &&
          typeof dims.y === "number" &&
          typeof dims.z === "number";
        primaryAssetByFileId.set(asset.fileId, {
          id: asset.id,
          format: asset.format,
          dimensions: dimsOk ? [dims.x, dims.y, dims.z] : null,
        });
      }
    }
  }

  const purchasedItems: LibraryItem[] = purchasedRows.map((r) => {
    const asset = primaryAssetByFileId.get(r.id);
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      price: r.price,
      visibility: r.visibility,
      source: "purchased" as const,
      thumbnailUrl: r.thumbnailUrl,
      primaryAssetId: asset?.id ?? null,
      primaryFormat: asset?.format ?? null,
      dimensions: asset?.dimensions ?? null,
      creatorUsername: r.creatorUsername,
      creatorDisplayName: r.creatorDisplayName,
    };
  });

  // Collections (only owned files live in them)
  const collectionConditions = [eq(collections.userId, userId)];
  if (!isOwner) {
    collectionConditions.push(eq(collections.visibility, "public"));
  }
  const userCollections = await db
    .select({
      id: collections.id,
      name: collections.name,
      slug: collections.slug,
      description: collections.description,
      visibility: collections.visibility,
    })
    .from(collections)
    .where(and(...collectionConditions))
    .orderBy(desc(collections.createdAt));

  const collectionFileRows =
    userCollections.length > 0
      ? await db
          .select()
          .from(collectionFiles)
          .where(
            inArray(
              collectionFiles.collectionId,
              userCollections.map((c) => c.id)
            )
          )
      : [];

  const ownedItems: LibraryItem[] = ownedFiles.map((f) => {
    const asset = primaryAssetByFileId.get(f.id);
    return {
      id: f.id,
      name: f.name,
      slug: f.slug,
      price: f.price,
      visibility: f.visibility,
      source: "owned" as const,
      thumbnailUrl: f.thumbnailUrl,
      primaryAssetId: asset?.id ?? null,
      primaryFormat: asset?.format ?? null,
      dimensions: asset?.dimensions ?? null,
    };
  });

  const itemMap = new Map(ownedItems.map((f) => [f.id, f]));
  const itemsInCollection = new Map<string, LibraryItem[]>();
  const idsInAnyCollection = new Set<string>();

  for (const row of collectionFileRows) {
    const item = itemMap.get(row.fileId);
    if (!item) continue;
    idsInAnyCollection.add(row.fileId);
    if (!itemsInCollection.has(row.collectionId)) {
      itemsInCollection.set(row.collectionId, []);
    }
    itemsInCollection.get(row.collectionId)!.push(item);
  }

  const uncollectedOwned = ownedItems.filter(
    (f) => !idsInAnyCollection.has(f.id)
  );
  // Purchased files can't be in a user-created collection, so they live
  // alongside the uncollected owned files in the "all files" grid.
  const mainGridItems: LibraryItem[] = [
    ...uncollectedOwned,
    ...purchasedItems,
  ];

  const totalItems = ownedItems.length + purchasedItems.length;
  const hasAnyContent = totalItems > 0 || userCollections.length > 0;

  if (!hasAnyContent) {
    return (
      <div className="rounded-2xl bg-muted/50 py-16 text-center">
        <p className="text-muted-foreground">
          {isOwner ? "Your library is empty." : "Nothing to show."}
        </p>
        {isOwner && (
          <div className="mt-4">
            <UploadDialog
              trigger={<Button>Upload your first file</Button>}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {isOwner && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {totalItems} {totalItems === 1 ? "file" : "files"}
            {userCollections.length > 0 &&
              ` · ${userCollections.length} ${userCollections.length === 1 ? "collection" : "collections"}`}
          </p>
          <div className="flex items-center gap-2">
            <NewCollectionButton />
            <UploadDialog
              trigger={
                <Button variant="outline" size="sm">
                  Upload file
                </Button>
              }
            />
          </div>
        </div>
      )}

      {(ownedTruncated || purchasedTruncated) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Showing your most recent {LIBRARY_MAX_FILES}{" "}
          {ownedTruncated && purchasedTruncated
            ? "owned and purchased files"
            : ownedTruncated
              ? "uploads"
              : "purchases"}
          . Older items aren&apos;t shown here yet — reach out if you need a full export.
        </div>
      )}

      {/* Collections — collapsible */}
      {userCollections.map((collection) => {
        const colFiles = itemsInCollection.get(collection.id) || [];
        if (colFiles.length === 0 && !isOwner) return null;
        return (
          <CollectionSection
            key={collection.id}
            collectionId={collection.id}
            name={collection.name}
            description={collection.description}
            visibility={collection.visibility}
            showVisibilityBadge={isOwner}
            isOwner={isOwner}
            fileCount={colFiles.length}
          >
            {colFiles.length > 0 ? (
              <FileGrid items={colFiles} isOwner={isOwner} />
            ) : (
              <p className="text-sm text-muted-foreground">Empty collection</p>
            )}
          </CollectionSection>
        );
      })}

      {/* Uncollected files — not collapsible, just a soft panel */}
      {mainGridItems.length > 0 && (
        <div className="rounded-2xl bg-muted/50 p-5">
          <FileGrid items={mainGridItems} isOwner={isOwner} />
        </div>
      )}
    </div>
  );
}

function FileGrid({
  items,
  isOwner,
}: {
  items: LibraryItem[];
  isOwner: boolean;
}) {
  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => (
        <LibraryFileCard key={item.id} item={item} isOwner={isOwner} />
      ))}
    </div>
  );
}
