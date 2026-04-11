import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files, collections, collectionFiles } from "@/lib/db/schema";
import { eq, desc, count, sql } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CollectionManager } from "@/components/collections/collection-manager";
import { getMaterialById } from "@/lib/materials";

export default async function UploadsPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const userFiles = await db
    .select()
    .from(files)
    .where(eq(files.userId, userId))
    .orderBy(desc(files.createdAt));

  // Get user's collections with file counts
  const userCollections = await db
    .select({
      id: collections.id,
      name: collections.name,
      slug: collections.slug,
      description: collections.description,
      visibility: collections.visibility,
      fileCount: sql<number>`(
        SELECT COUNT(*) FROM collection_files
        WHERE collection_files.collection_id = ${collections.id}
      )`.as("file_count"),
    })
    .from(collections)
    .where(eq(collections.userId, userId))
    .orderBy(desc(collections.createdAt));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your Uploads</h1>
        <Button render={<Link href="/dashboard/uploads/new" />}>
          Upload new file
        </Button>
      </div>

      {/* Collections */}
      <div className="mt-8">
        <CollectionManager
          collections={userCollections.map((c) => ({
            ...c,
            fileCount: Number(c.fileCount),
          }))}
        />
      </div>

      <Separator className="my-8" />

      {/* Files */}
      {userFiles.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-muted-foreground">
            No uploads yet. Upload your first 3D file to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {userFiles.map((file) => {
            const material = file.recommendedMaterialId
              ? getMaterialById(file.recommendedMaterialId)
              : null;

            return (
              <Link key={file.id} href={`/files/${file.slug}`}>
                <Card className="overflow-hidden transition-colors hover:border-primary/30">
                  <div className="aspect-square bg-gradient-to-br from-muted to-muted/50" />
                  <CardContent className="p-4">
                    <h3 className="font-medium text-sm">{file.name}</h3>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <Badge
                        variant={
                          file.status === "published"
                            ? "secondary"
                            : file.status === "draft"
                              ? "outline"
                              : "destructive"
                        }
                        className="text-[10px] capitalize"
                      >
                        {file.status}
                      </Badge>
                      {file.visibility === "private" && (
                        <Badge variant="outline" className="text-[10px]">
                          Hidden
                        </Badge>
                      )}
                      {file.price > 0 ? (
                        <span className="text-xs font-medium">
                          ${(file.price / 100).toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Free
                        </span>
                      )}
                    </div>
                    {material && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <div
                          className="h-3 w-3 rounded-sm border border-border"
                          style={{ backgroundColor: material.color }}
                        />
                        <span className="text-[10px] text-muted-foreground">
                          {material.name}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
