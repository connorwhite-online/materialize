import Link from "next/link";
import { db } from "@/lib/db";
import {
  files,
  collections,
  collectionFiles,
  purchases,
  users,
} from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CollectionSection } from "./collection-section";

interface LibraryTabProps {
  userId: string;
  isOwner: boolean;
}

type LibraryItem = {
  id: string;
  name: string;
  slug: string;
  price: number;
  status: string;
  visibility: string;
  thumbnailUrl: string | null;
  source: "owned" | "purchased";
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
};

export async function LibraryTab({ userId, isOwner }: LibraryTabProps) {
  // Owned files (creator content)
  const fileConditions = [eq(files.userId, userId)];
  if (!isOwner) {
    fileConditions.push(eq(files.status, "published"));
    fileConditions.push(eq(files.visibility, "public"));
  }
  const ownedFiles = await db
    .select()
    .from(files)
    .where(and(...fileConditions))
    .orderBy(desc(files.createdAt));

  // Purchased files (buyer content) — owner only, since purchases are private
  let purchasedItems: LibraryItem[] = [];
  if (isOwner) {
    const rows = await db
      .select({
        id: files.id,
        name: files.name,
        slug: files.slug,
        price: files.price,
        status: files.status,
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
      );

    purchasedItems = rows.map((r) => ({
      ...r,
      source: "purchased" as const,
    }));
  }

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

  const ownedItems: LibraryItem[] = ownedFiles.map((f) => ({
    id: f.id,
    name: f.name,
    slug: f.slug,
    price: f.price,
    status: f.status,
    visibility: f.visibility,
    thumbnailUrl: f.thumbnailUrl,
    source: "owned" as const,
  }));

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
          <Button
            className="mt-4"
            render={<Link href="/dashboard/uploads/new" />}
          >
            Upload your first file
          </Button>
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
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/dashboard/uploads/new" />}
          >
            Upload file
          </Button>
        </div>
      )}

      {/* Collections — collapsible */}
      {userCollections.map((collection) => {
        const colFiles = itemsInCollection.get(collection.id) || [];
        if (colFiles.length === 0 && !isOwner) return null;
        return (
          <CollectionSection
            key={collection.id}
            name={collection.name}
            description={collection.description}
            visibility={collection.visibility}
            showVisibilityBadge={isOwner}
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
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => (
        <Link key={item.id} href={`/files/${item.slug}`}>
          <Card className="group overflow-hidden transition-colors hover:border-primary/30">
            <div className="aspect-square bg-gradient-to-br from-muted to-muted/50" />
            <CardContent className="p-4">
              <h3 className="truncate text-sm font-medium transition-colors group-hover:text-primary">
                {item.name}
              </h3>
              {item.source === "purchased" && item.creatorUsername && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  by {item.creatorDisplayName || item.creatorUsername}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {item.source === "purchased" && (
                  <Badge variant="secondary" className="text-[10px]">
                    Purchased
                  </Badge>
                )}
                {item.source === "owned" &&
                  isOwner &&
                  item.status !== "published" && (
                    <Badge
                      variant="outline"
                      className="text-[10px] capitalize"
                    >
                      {item.status}
                    </Badge>
                  )}
                {item.source === "owned" &&
                  isOwner &&
                  item.visibility === "private" && (
                    <Badge variant="outline" className="text-[10px]">
                      Hidden
                    </Badge>
                  )}
                {item.source === "owned" &&
                  (item.price > 0 ? (
                    <span className="text-sm font-medium tabular-nums">
                      ${(item.price / 100).toFixed(2)}
                    </span>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">
                      Free
                    </Badge>
                  ))}
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
