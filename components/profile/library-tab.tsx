import { db } from "@/lib/db";
import {
  files,
  fileAssets,
  collections,
  collectionItems,
  purchases,
  users,
  projects,
  projectFiles,
} from "@/lib/db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { CollectionSection } from "./collection-section";
import {
  LibraryFileCard,
  type LibraryFileCardItem,
} from "./library-file-card";
import {
  LibraryProjectCard,
  type LibraryProjectCardItem,
} from "./library-project-card";
import { NewCollectionButton } from "./new-collection-button";
import { UploadDialog } from "@/components/upload/upload-dialog";
import Link from "next/link";

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

  const collectionItemRows =
    userCollections.length > 0
      ? await db
          .select()
          .from(collectionItems)
          .where(
            inArray(
              collectionItems.collectionId,
              userCollections.map((c) => c.id)
            )
          )
      : [];

  // Owned projects (creator's bundles)
  const ownedProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      price: projects.price,
      visibility: projects.visibility,
      thumbnailUrl: projects.thumbnailUrl,
      fileCount: sql<number>`cast(count(${projectFiles.fileId}) as int)`,
    })
    .from(projects)
    .leftJoin(projectFiles, eq(projectFiles.projectId, projects.id))
    .where(
      and(
        eq(projects.userId, userId),
        ...(isOwner ? [] : [eq(projects.status, "published"), eq(projects.visibility, "public")])
      )
    )
    .groupBy(projects.id)
    .orderBy(desc(projects.createdAt));

  // Purchased projects (owner-only). The bundled files come along for
  // free via the entitlement helper at download time, so we don't need
  // to flatten them into the file grid.
  type PurchasedProjectRow = LibraryProjectCardItem;
  let purchasedProjects: PurchasedProjectRow[] = [];
  if (isOwner) {
    const rawPurchased = await db
      .select({
        id: projects.id,
        name: projects.name,
        slug: projects.slug,
        price: projects.price,
        visibility: projects.visibility,
        thumbnailUrl: projects.thumbnailUrl,
      })
      .from(purchases)
      .innerJoin(projects, eq(purchases.projectId, projects.id))
      .where(
        and(
          eq(purchases.buyerId, userId),
          eq(purchases.status, "completed")
        )
      );
    if (rawPurchased.length > 0) {
      const purchasedIds = rawPurchased.map((p) => p.id);
      const counts = await db
        .select({
          projectId: projectFiles.projectId,
          count: sql<number>`cast(count(${projectFiles.fileId}) as int)`,
        })
        .from(projectFiles)
        .where(inArray(projectFiles.projectId, purchasedIds))
        .groupBy(projectFiles.projectId);
      const countMap = new Map(counts.map((c) => [c.projectId, c.count]));
      purchasedProjects = rawPurchased.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        price: p.price,
        visibility: p.visibility,
        source: "purchased" as const,
        thumbnailUrl: p.thumbnailUrl,
        fileCount: countMap.get(p.id) ?? 0,
      }));
    }
  }

  // Files referenced by any of the user's owned projects — we dedupe
  // these out of the standalone file grid so a creator doesn't see the
  // same file twice (once inside its project card, once on its own).
  let fileIdsInOwnedProjects = new Set<string>();
  if (ownedProjects.length > 0) {
    const ownedProjectIds = ownedProjects.map((p) => p.id);
    const links = await db
      .select({ fileId: projectFiles.fileId })
      .from(projectFiles)
      .where(inArray(projectFiles.projectId, ownedProjectIds));
    fileIdsInOwnedProjects = new Set(links.map((l) => l.fileId));
  }

  const ownedProjectItems: LibraryProjectCardItem[] = ownedProjects.map(
    (p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      price: p.price,
      visibility: p.visibility,
      source: "owned" as const,
      thumbnailUrl: p.thumbnailUrl,
      fileCount: p.fileCount,
    })
  );

  const ownedItems: LibraryItem[] = ownedFiles
    .filter((f) => !fileIdsInOwnedProjects.has(f.id))
    .map((f) => {
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

  for (const row of collectionItemRows) {
    if (!row.fileId) continue;
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
  const mainGridItems: LibraryItem[] = [
    ...uncollectedOwned,
    ...purchasedItems,
  ];
  const projectGridItems: LibraryProjectCardItem[] = [
    ...ownedProjectItems,
    ...purchasedProjects,
  ];

  const totalItems =
    ownedItems.length +
    purchasedItems.length +
    ownedProjectItems.length +
    purchasedProjects.length;
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
            {totalItems} {totalItems === 1 ? "item" : "items"}
            {userCollections.length > 0 &&
              ` · ${userCollections.length} ${userCollections.length === 1 ? "collection" : "collections"}`}
          </p>
          <div className="flex items-center gap-2">
            <NewCollectionButton />
            {ownedFiles.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                render={<Link href="/projects/new" />}
              >
                New project
              </Button>
            )}
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

      {/* Projects (owned + purchased bundles) */}
      {projectGridItems.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Projects
          </p>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {projectGridItems.map((p) => (
              <LibraryProjectCard key={p.id} item={p} />
            ))}
          </div>
        </div>
      )}

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
