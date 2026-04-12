import Link from "next/link";
import { db } from "@/lib/db";
import { files, users } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AuthNav } from "@/components/auth/auth-nav";

export default async function HomePage() {
  // Fetch recent published files for the gallery
  const recentFiles = await db
    .select({
      id: files.id,
      name: files.name,
      slug: files.slug,
      price: files.price,
      license: files.license,
      thumbnailUrl: files.thumbnailUrl,
      username: users.username,
      displayName: users.displayName,
    })
    .from(files)
    .innerJoin(users, eq(files.userId, users.id))
    .where(and(eq(files.status, "published"), eq(files.visibility, "public")))
    .orderBy(desc(files.createdAt))
    .limit(12);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Minimal header */}
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <span className="text-lg font-semibold tracking-tight">
            Materialize
          </span>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/materials"
              className="text-muted-foreground transition-colors hover:text-foreground hidden sm:inline"
            >
              Materials
            </Link>
            <AuthNav />
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero — just a search bar */}
        <div className="mx-auto max-w-2xl px-4 pt-16 pb-12 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Materialize
          </h1>
          <p className="mt-3 text-muted-foreground">
            Discover, share, and print 3D files
          </p>

          {/* Search bar */}
          <form action="/files" method="GET" className="mt-8">
            <div className="relative">
              <input
                name="q"
                type="text"
                placeholder="Search files, materials, creators..."
                className="w-full rounded-xl border border-border bg-background px-5 py-3.5 text-sm shadow-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/50"
              />
              <button
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Search
              </button>
            </div>
          </form>

          {/* Secondary CTAs under search */}
          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              render={<Link href="/materials" />}
            >
              Explore materials
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              render={<Link href="/dashboard/uploads/new" />}
            >
              Upload file
            </Button>
          </div>
        </div>

        {/* Community gallery */}
        {recentFiles.length > 0 && (
          <div className="mx-auto max-w-7xl px-4 pb-16">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {recentFiles.map((file) => (
                <Link key={file.id} href={`/files/${file.slug}`}>
                  <Card className="overflow-hidden group transition-colors hover:border-primary/20">
                    <div className="aspect-square bg-gradient-to-br from-muted to-muted/40 flex items-center justify-center">
                      <span className="text-muted-foreground/30 text-xs">
                        3D
                      </span>
                    </div>
                    <CardContent className="p-3">
                      <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                        {file.name}
                      </p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-muted-foreground truncate">
                          {file.displayName || file.username}
                        </span>
                        {file.price > 0 ? (
                          <span className="text-xs font-medium">
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

            <div className="mt-8 text-center">
              <Button variant="outline" render={<Link href="/files" />}>
                Browse all files
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
