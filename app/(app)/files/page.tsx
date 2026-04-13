import { db } from "@/lib/db";
import { files, users } from "@/lib/db/schema";
import { eq, desc, ilike, and } from "drizzle-orm";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default async function BrowsePage(props: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const searchParams = await props.searchParams;
  const query = searchParams.q;
  const page = Number(searchParams.page) || 1;
  const perPage = 24;

  const conditions = [eq(files.status, "published"), eq(files.visibility, "public")];
  if (query) {
    conditions.push(ilike(files.name, `%${query}%`));
  }

  const publishedFiles = await db
    .select({
      id: files.id,
      name: files.name,
      slug: files.slug,
      price: files.price,
      thumbnailUrl: files.thumbnailUrl,
      downloadCount: files.downloadCount,
      createdAt: files.createdAt,
      username: users.username,
      displayName: users.displayName,
    })
    .from(files)
    .innerJoin(users, eq(files.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(files.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Browse Files</h1>
        <form className="flex gap-2">
          <Input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search files..."
            className="w-48 sm:w-64"
          />
          <Button type="submit" variant="secondary" size="default">
            Search
          </Button>
        </form>
      </div>

      {publishedFiles.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-muted-foreground">
            {query
              ? `No files found for "${query}"`
              : "No files published yet"}
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {publishedFiles.map((file) => (
            <Link key={file.id} href={`/files/${file.slug}`}>
              <Card className="gap-0 py-0 overflow-hidden group transition-colors hover:border-primary/30">
                <div className="aspect-square bg-gradient-to-br from-muted to-muted/50">
                  {file.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={file.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <CardContent className="p-4">
                  <h3 className="font-medium text-sm group-hover:text-primary transition-colors">
                    {file.name}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {file.displayName || file.username || "Unknown"}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    {file.price > 0 ? (
                      <span className="text-sm font-medium tabular-nums">
                        ${(file.price / 100).toFixed(2)}
                      </span>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        Free
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {file.downloadCount} downloads
                    </span>
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
