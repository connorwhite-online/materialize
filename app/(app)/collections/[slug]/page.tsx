import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { collections, collectionFiles, files, users } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function CollectionPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;

  const [collection] = await db
    .select({
      id: collections.id,
      name: collections.name,
      description: collections.description,
      visibility: collections.visibility,
      creatorUsername: users.username,
      creatorDisplayName: users.displayName,
    })
    .from(collections)
    .innerJoin(users, eq(collections.userId, users.id))
    .where(and(eq(collections.slug, slug), eq(collections.visibility, "public")));

  if (!collection) notFound();

  const items = await db
    .select({
      fileId: files.id,
      name: files.name,
      slug: files.slug,
      description: files.description,
      price: files.price,
      license: files.license,
      thumbnailUrl: files.thumbnailUrl,
      downloadCount: files.downloadCount,
    })
    .from(collectionFiles)
    .innerJoin(files, eq(collectionFiles.fileId, files.id))
    .where(
      and(
        eq(collectionFiles.collectionId, collection.id),
        eq(files.status, "published"),
        eq(files.visibility, "public")
      )
    )
    .orderBy(asc(collectionFiles.sortOrder));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">{collection.name}</h1>
        {collection.description && (
          <p className="mt-2 text-muted-foreground">{collection.description}</p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          by{" "}
          <Link
            href={`/u/${collection.creatorUsername}`}
            className="hover:underline"
          >
            {collection.creatorDisplayName || collection.creatorUsername}
          </Link>
          {" · "}
          {items.length} {items.length === 1 ? "file" : "files"}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground">
          This collection is empty.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((item) => (
            <Link key={item.fileId} href={`/files/${item.slug}`}>
              <Card className="overflow-hidden transition-colors hover:border-primary/30">
                <div className="aspect-[4/3] bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                  <span className="text-muted-foreground/40 text-sm">
                    3D Preview
                  </span>
                </div>
                <CardContent className="p-4">
                  <h3 className="font-semibold text-sm">{item.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {item.license}
                    </Badge>
                    {item.price > 0 ? (
                      <span className="text-xs font-medium">
                        ${(item.price / 100).toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Free</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
