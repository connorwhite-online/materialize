import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import {
  collections,
  collectionItems,
  files,
  projects,
  projectFiles,
  users,
} from "@/lib/db/schema";
import { eq, and, isNotNull, inArray, sql } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type FileItem = {
  kind: "file";
  id: string;
  slug: string;
  name: string;
  thumbnailUrl: string | null;
  price: number;
  license: string;
  sortOrder: number;
};

type ProjectItem = {
  kind: "project";
  id: string;
  slug: string;
  name: string;
  thumbnailUrl: string | null;
  price: number;
  license: string;
  fileCount: number;
  sortOrder: number;
};

type Item = FileItem | ProjectItem;

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

  const fileRows = await db
    .select({
      id: files.id,
      name: files.name,
      slug: files.slug,
      thumbnailUrl: files.thumbnailUrl,
      price: files.price,
      license: files.license,
      sortOrder: collectionItems.sortOrder,
    })
    .from(collectionItems)
    .innerJoin(files, eq(collectionItems.fileId, files.id))
    .where(
      and(
        eq(collectionItems.collectionId, collection.id),
        isNotNull(collectionItems.fileId),
        eq(files.status, "published"),
        eq(files.visibility, "public")
      )
    );

  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      thumbnailUrl: projects.thumbnailUrl,
      price: projects.price,
      license: projects.license,
      sortOrder: collectionItems.sortOrder,
    })
    .from(collectionItems)
    .innerJoin(projects, eq(collectionItems.projectId, projects.id))
    .where(
      and(
        eq(collectionItems.collectionId, collection.id),
        isNotNull(collectionItems.projectId),
        eq(projects.status, "published"),
        eq(projects.visibility, "public")
      )
    );

  // Look up file counts for each project — used in the "N files" badge.
  const projectIds = projectRows.map((p) => p.id);
  const fileCounts = new Map<string, number>();
  if (projectIds.length > 0) {
    const counts = await db
      .select({
        projectId: projectFiles.projectId,
        count: sql<number>`cast(count(${projectFiles.fileId}) as int)`,
      })
      .from(projectFiles)
      .where(inArray(projectFiles.projectId, projectIds))
      .groupBy(projectFiles.projectId);
    for (const row of counts) {
      fileCounts.set(row.projectId, row.count);
    }
  }

  const items: Item[] = [
    ...fileRows.map<FileItem>((r) => ({
      kind: "file",
      id: r.id,
      slug: r.slug,
      name: r.name,
      thumbnailUrl: r.thumbnailUrl,
      price: r.price,
      license: r.license,
      sortOrder: r.sortOrder,
    })),
    ...projectRows.map<ProjectItem>((r) => ({
      kind: "project",
      id: r.id,
      slug: r.slug,
      name: r.name,
      thumbnailUrl: r.thumbnailUrl,
      price: r.price,
      license: r.license,
      fileCount: fileCounts.get(r.id) ?? 0,
      sortOrder: r.sortOrder,
    })),
  ].sort((a, b) => a.sortOrder - b.sortOrder);

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
          {items.length} {items.length === 1 ? "item" : "items"}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground">This collection is empty.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((item) => (
            <Link
              key={`${item.kind}-${item.id}`}
              href={
                item.kind === "file"
                  ? `/files/${item.slug}`
                  : `/projects/${item.slug}`
              }
            >
              <Card className="overflow-hidden transition-colors hover:border-primary/30">
                <div className="aspect-[4/3] bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                  {item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-muted-foreground/40 text-sm">
                      {item.kind === "file" ? "3D Preview" : "Project"}
                    </span>
                  )}
                </div>
                <CardContent className="p-4">
                  <h3 className="font-semibold text-sm">{item.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    {item.kind === "project" && (
                      <Badge variant="outline" className="text-[10px]">
                        {item.fileCount}{" "}
                        {item.fileCount === 1 ? "file" : "files"}
                      </Badge>
                    )}
                    <Badge
                      variant="outline"
                      className="text-[10px] capitalize"
                    >
                      {item.license}
                    </Badge>
                    {item.price > 0 ? (
                      <span className="text-xs font-medium">
                        ${(item.price / 100).toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Free
                      </span>
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
