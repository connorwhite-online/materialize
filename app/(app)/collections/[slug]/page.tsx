import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { db } from "@/lib/db";
import {
  collections,
  collectionItems,
  files,
  projects,
  projectFiles,
  users,
} from "@/lib/db/schema";
import { eq, and, isNotNull, inArray, sql, asc } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { isOrgMember } from "@/lib/authorization";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OwnerBar } from "@/components/ui/owner-bar";
import { CollectionSettingsMenu } from "@/components/profile/collection-settings-menu";
import { getLicenseMeta } from "@/lib/licenses";

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

// Cap collection item fetches at a user-friendly ceiling, mirroring
// LIBRARY_MAX_FILES in components/profile/library-tab.tsx. Real
// pagination is a future refactor; a truncation notice flags the cap
// to the user so nothing silently disappears.
const COLLECTION_MAX_ITEMS = 500;

export default async function CollectionPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;

  const { userId: viewerId } = await auth();

  // Pull the row without a visibility filter so we can apply the
  // org-aware access check below. Private personal collections are
  // owner-only; private org collections are visible to every org
  // member.
  const [collection] = await db
    .select({
      id: collections.id,
      name: collections.name,
      description: collections.description,
      visibility: collections.visibility,
      userId: collections.userId,
      organizationId: collections.organizationId,
      creatorUsername: users.username,
      creatorDisplayName: users.displayName,
    })
    .from(collections)
    .innerJoin(users, eq(collections.userId, users.id))
    .where(eq(collections.slug, slug));

  if (!collection) notFound();

  // Owner = creator or a member of the owning org. Drives both the
  // private-visibility gate and the admin OwnerBar.
  const isOwner =
    !!viewerId &&
    (viewerId === collection.userId ||
      (collection.organizationId !== null &&
        (await isOrgMember(viewerId, collection.organizationId)).member));

  if (collection.visibility !== "public" && !isOwner) notFound();

  const [fileRowsRaw, projectRowsRaw] = await Promise.all([
    db
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
      )
      // Ordered so a truncated fetch keeps the items the owner placed
      // first, rather than an arbitrary DB-order subset.
      .orderBy(asc(collectionItems.sortOrder))
      // Fetch one extra so we can tell if the collection was
      // truncated without a second count() query.
      .limit(COLLECTION_MAX_ITEMS + 1),
    db
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
      )
      .orderBy(asc(collectionItems.sortOrder))
      .limit(COLLECTION_MAX_ITEMS + 1),
  ]);
  const fileRowsTruncated = fileRowsRaw.length > COLLECTION_MAX_ITEMS;
  const fileRows = fileRowsTruncated
    ? fileRowsRaw.slice(0, COLLECTION_MAX_ITEMS)
    : fileRowsRaw;
  const projectRowsTruncated = projectRowsRaw.length > COLLECTION_MAX_ITEMS;
  const projectRows = projectRowsTruncated
    ? projectRowsRaw.slice(0, COLLECTION_MAX_ITEMS)
    : projectRowsRaw;
  const itemsTruncated = fileRowsTruncated || projectRowsTruncated;

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
      {/* Admin-only bar — visibility status + owner controls. */}
      {isOwner && (
        <div className="mb-6">
          <OwnerBar
            visibility={collection.visibility === "public" ? "public" : "private"}
          >
            <CollectionSettingsMenu
              collectionId={collection.id}
              name={collection.name}
              description={collection.description}
              visibility={
                collection.visibility === "public" ? "public" : "private"
              }
            />
          </OwnerBar>
        </div>
      )}
      <div className="mb-8">
        <h1 className="text-2xl font-bold">{collection.name}</h1>
        {collection.description && (
          <p className="mt-2 text-muted-foreground">{collection.description}</p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          by{" "}
          <Link
            href={`/${collection.creatorUsername}`}
            className="hover:underline"
          >
            {collection.creatorDisplayName || collection.creatorUsername}
          </Link>
          {" · "}
          {items.length} {items.length === 1 ? "item" : "items"}
        </p>
      </div>

      {itemsTruncated && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Showing the first {COLLECTION_MAX_ITEMS}{" "}
          {fileRowsTruncated && projectRowsTruncated
            ? "files and projects"
            : fileRowsTruncated
              ? "files"
              : "projects"}
          . Older items aren&apos;t shown here yet — reach out if you need a full export.
        </div>
      )}

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
                <div className="relative aspect-[4/3] bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                  {item.thumbnailUrl ? (
                    <Image
                      src={item.thumbnailUrl}
                      alt={item.name}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
                      className="object-cover"
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
                    <Badge variant="outline" className="text-[10px]">
                      {getLicenseMeta(item.license)?.shortName ?? item.license}
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
