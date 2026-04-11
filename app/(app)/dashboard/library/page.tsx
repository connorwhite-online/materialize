import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { purchases, files, fileAssets, users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default async function LibraryPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const purchasedFiles = await db
    .select({
      purchaseId: purchases.id,
      purchasedAt: purchases.createdAt,
      file: {
        id: files.id,
        name: files.name,
        slug: files.slug,
        description: files.description,
        license: files.license,
        thumbnailUrl: files.thumbnailUrl,
      },
      creator: {
        username: users.username,
        displayName: users.displayName,
      },
    })
    .from(purchases)
    .innerJoin(files, eq(purchases.fileId, files.id))
    .innerJoin(users, eq(files.userId, users.id))
    .where(and(eq(purchases.buyerId, userId), eq(purchases.status, "completed")));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold">My Library</h1>
      <p className="mt-1 text-muted-foreground">
        Files you&apos;ve purchased. Download or print anytime.
      </p>

      {purchasedFiles.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-muted-foreground">
            No files in your library yet.
          </p>
          <Button variant="outline" className="mt-4" render={<Link href="/files" />}>
            Browse marketplace
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {purchasedFiles.map((item) => (
            <LibraryFileCard key={item.purchaseId} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function LibraryFileCard({
  item,
}: {
  item: {
    purchaseId: string;
    purchasedAt: Date;
    file: {
      id: string;
      name: string;
      slug: string;
      description: string | null;
      license: string;
      thumbnailUrl: string | null;
    };
    creator: {
      username: string | null;
      displayName: string | null;
    };
  };
}) {
  return (
    <Card className="overflow-hidden">
      {/* Thumbnail or placeholder */}
      <div className="aspect-[4/3] bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
        <span className="text-muted-foreground/40 text-sm">3D Preview</span>
      </div>

      <CardContent className="p-4">
        <h3 className="font-semibold text-sm">{item.file.name}</h3>

        {/* Attribution */}
        <p className="text-xs text-muted-foreground mt-1">
          by{" "}
          <Link
            href={`/u/${item.creator.username}`}
            className="hover:underline"
          >
            {item.creator.displayName || item.creator.username}
          </Link>
        </p>

        <div className="flex items-center gap-2 mt-2">
          <Badge variant="outline" className="text-[10px] capitalize">
            {item.file.license}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            Purchased{" "}
            {item.purchasedAt.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>

        <div className="flex gap-2 mt-3">
          <Button size="sm" variant="outline" className="flex-1" render={
            <Link href={`/files/${item.file.slug}/download`} />
          }>
            Download
          </Button>
          <Button size="sm" className="flex-1" render={
            <Link href={`/files/${item.file.slug}`} />
          }>
            View / Print
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
