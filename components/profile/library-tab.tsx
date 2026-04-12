import Link from "next/link";
import { db } from "@/lib/db";
import { purchases, files, users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export async function LibraryTab({ userId }: { userId: string }) {
  const items = await db
    .select({
      purchaseId: purchases.id,
      purchasedAt: purchases.createdAt,
      fileId: files.id,
      name: files.name,
      slug: files.slug,
      license: files.license,
      creatorUsername: users.username,
      creatorDisplayName: users.displayName,
    })
    .from(purchases)
    .innerJoin(files, eq(purchases.fileId, files.id))
    .innerJoin(users, eq(files.userId, users.id))
    .where(and(eq(purchases.buyerId, userId), eq(purchases.status, "completed")));

  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">No files in your library yet.</p>
        <Button variant="outline" className="mt-4" render={<Link href="/files" />}>
          Browse marketplace
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => (
        <Card key={item.purchaseId} className="overflow-hidden">
          <div className="aspect-[4/3] bg-gradient-to-br from-muted to-muted/50" />
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm">{item.name}</h3>
            <p className="text-xs text-muted-foreground mt-1">
              by{" "}
              <Link
                href={`/u/${item.creatorUsername}`}
                className="hover:underline"
              >
                {item.creatorDisplayName || item.creatorUsername}
              </Link>
            </p>
            <div className="mt-2">
              <Badge variant="outline" className="text-[10px] capitalize">
                {item.license}
              </Badge>
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="outline" className="flex-1" render={
                <Link href={`/files/${item.slug}/download`} />
              }>
                Download
              </Button>
              <Button size="sm" className="flex-1" render={
                <Link href={`/files/${item.slug}`} />
              }>
                View
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
