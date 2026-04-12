import Link from "next/link";
import { db } from "@/lib/db";
import { files, collections, collectionFiles } from "@/lib/db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface FilesTabProps {
  userId: string;
  isOwner: boolean;
}

export async function FilesTab({ userId, isOwner }: FilesTabProps) {
  // Fetch all the user's files (owner sees all, others only see published+public)
  const fileConditions = [eq(files.userId, userId)];
  if (!isOwner) {
    fileConditions.push(eq(files.status, "published"));
    fileConditions.push(eq(files.visibility, "public"));
  }

  const allFiles = await db
    .select()
    .from(files)
    .where(and(...fileConditions))
    .orderBy(desc(files.createdAt));

  // Fetch all collections
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

  // Fetch the junction table to know which files are in which collections
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

  // Build a map: collectionId -> file[]
  const fileMap = new Map(allFiles.map((f) => [f.id, f]));
  const filesInCollection = new Map<string, typeof allFiles>();
  const fileIdsInAnyCollection = new Set<string>();

  for (const row of collectionFileRows) {
    const file = fileMap.get(row.fileId);
    if (!file) continue;
    fileIdsInAnyCollection.add(row.fileId);
    if (!filesInCollection.has(row.collectionId)) {
      filesInCollection.set(row.collectionId, []);
    }
    filesInCollection.get(row.collectionId)!.push(file);
  }

  const ungroupedFiles = allFiles.filter(
    (f) => !fileIdsInAnyCollection.has(f.id)
  );

  const hasAnyContent =
    allFiles.length > 0 || userCollections.length > 0;

  if (!hasAnyContent) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">
          {isOwner ? "No files yet." : "Nothing to show."}
        </p>
        {isOwner && (
          <Button className="mt-4" render={<Link href="/dashboard/uploads/new" />}>
            Upload your first file
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {isOwner && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {allFiles.length} {allFiles.length === 1 ? "file" : "files"}
            {userCollections.length > 0 &&
              ` · ${userCollections.length} ${userCollections.length === 1 ? "collection" : "collections"}`}
          </p>
          <Button variant="outline" size="sm" render={<Link href="/dashboard/uploads/new" />}>
            Upload file
          </Button>
        </div>
      )}

      {/* Collections */}
      {userCollections.map((collection) => {
        const colFiles = filesInCollection.get(collection.id) || [];
        if (colFiles.length === 0 && !isOwner) return null;
        return (
          <section key={collection.id}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-semibold">{collection.name}</h2>
                {collection.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {collection.description}
                  </p>
                )}
              </div>
              {isOwner && collection.visibility === "private" && (
                <Badge variant="outline" className="text-[10px]">
                  Hidden
                </Badge>
              )}
            </div>
            {colFiles.length > 0 ? (
              <FileGrid files={colFiles} isOwner={isOwner} />
            ) : (
              <p className="text-sm text-muted-foreground">Empty collection</p>
            )}
          </section>
        );
      })}

      {/* Ungrouped files */}
      {ungroupedFiles.length > 0 && (
        <section>
          {userCollections.length > 0 && (
            <h2 className="text-lg font-semibold mb-3">
              {isOwner ? "Uncollected" : "Other files"}
            </h2>
          )}
          <FileGrid files={ungroupedFiles} isOwner={isOwner} />
        </section>
      )}
    </div>
  );
}

function FileGrid({
  files,
  isOwner,
}: {
  files: Array<{
    id: string;
    name: string;
    slug: string;
    price: number;
    status: string;
    visibility: string;
    thumbnailUrl: string | null;
  }>;
  isOwner: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {files.map((file) => (
        <Link key={file.id} href={`/files/${file.slug}`}>
          <Card className="overflow-hidden group transition-colors hover:border-primary/30">
            <div className="aspect-square bg-gradient-to-br from-muted to-muted/50" />
            <CardContent className="p-4">
              <h3 className="font-medium text-sm group-hover:text-primary transition-colors truncate">
                {file.name}
              </h3>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                {isOwner && file.status !== "published" && (
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {file.status}
                  </Badge>
                )}
                {isOwner && file.visibility === "private" && (
                  <Badge variant="outline" className="text-[10px]">
                    Hidden
                  </Badge>
                )}
                {file.price > 0 ? (
                  <span className="text-sm font-medium tabular-nums">
                    ${(file.price / 100).toFixed(2)}
                  </span>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">
                    Free
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
