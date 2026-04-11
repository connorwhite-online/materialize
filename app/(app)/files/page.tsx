import { db } from "@/lib/db";
import { files, users } from "@/lib/db/schema";
import { eq, desc, ilike, and } from "drizzle-orm";
import Link from "next/link";

export default async function BrowsePage(props: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const searchParams = await props.searchParams;
  const query = searchParams.q;
  const page = Number(searchParams.page) || 1;
  const perPage = 24;

  const conditions = [eq(files.status, "published")];
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Browse Files</h1>
        <form className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search files..."
            className="rounded-md border border-foreground/20 bg-background px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background"
          >
            Search
          </button>
        </form>
      </div>
      {publishedFiles.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-foreground/60">
            {query ? `No files found for "${query}"` : "No files published yet"}
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {publishedFiles.map((file) => (
            <Link
              key={file.id}
              href={`/files/${file.slug}`}
              className="group rounded-lg border border-foreground/10 p-4 transition-colors hover:border-foreground/20"
            >
              <div className="aspect-square rounded-md bg-foreground/5" />
              <h3 className="mt-3 font-medium group-hover:underline">
                {file.name}
              </h3>
              <p className="mt-0.5 text-sm text-foreground/60">
                by {file.displayName || file.username || "Unknown"}
              </p>
              <div className="mt-1 flex items-center justify-between text-sm">
                {file.price > 0 ? (
                  <span className="font-medium">
                    ${(file.price / 100).toFixed(2)}
                  </span>
                ) : (
                  <span className="text-foreground/60">Free</span>
                )}
                <span className="text-foreground/40">
                  {file.downloadCount} downloads
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
