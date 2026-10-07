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
import { eq, and, isNotNull, inArray, sql, asc } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { isOrgMember } from "@/lib/authorization";
import { OwnerBar } from "@/components/ui/owner-bar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState, Page } from "@/components/ui/page";
import { CollectionSettingsMenu } from "@/components/profile/collection-settings-menu";
import {
  FileCard,
  FileCardPriceBadge,
} from "@/components/files/file-card";
import { FolderOpenIcon } from "@/components/icons/oai";

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

  const creatorName = collection.creatorDisplayName || collection.creatorUsername;

  return (
    <Page width="wide" className="gap-8">
      {/* Admin-only bar — visibility status + owner controls. */}
      {isOwner && (
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
      )}
      <header className="flex flex-col gap-2">
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          Collection by{" "}
          <Link
            href={`/${collection.creatorUsername}`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {creatorName}
          </Link>
          <span className="tabular-nums">
            {" · "}
            {items.length} {items.length === 1 ? "item" : "items"}
          </span>
        </p>
        <h1 className="text-2xl leading-7 font-semibold text-balance">
          {collection.name}
        </h1>
        {collection.description && (
          <p className="max-w-prose text-sm leading-6 text-pretty text-muted-foreground">
            {collection.description}
          </p>
        )}
      </header>

      {itemsTruncated && (
        <Alert variant="warning">
          <AlertDescription>
          Showing the first {COLLECTION_MAX_ITEMS}{" "}
          {fileRowsTruncated && projectRowsTruncated
            ? "files and projects"
            : fileRowsTruncated
              ? "files"
              : "projects"}
          . Older items aren&apos;t shown here yet — reach out if you need a full export.
          </AlertDescription>
        </Alert>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<FolderOpenIcon />}
          title="This collection is empty"
          description={
            isOwner
              ? "Use “Add to collection” on any file or project page to fill this shelf."
              : "Nothing on this shelf yet. Check back soon."
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((item) => {
            // Files need no kind label (they are the default thing on
            // the shelf); projects say so, with their size.
            const subtitle =
              item.kind === "project"
                ? `Project · ${item.fileCount} ${item.fileCount === 1 ? "file" : "files"}`
                : null;
            return (
              <FileCard
                key={`${item.kind}-${item.id}`}
                href={
                  item.kind === "file"
                    ? `/files/${item.slug}`
                    : `/projects/${item.slug}`
                }
                title={item.name}
                thumbnailUrl={item.thumbnailUrl}
                placeholder={item.kind === "file" ? "No preview" : "Project"}
                overlay={<FileCardPriceBadge priceCents={item.price} />}
                subtitle={subtitle}
              />
            );
          })}
        </div>
      )}
    </Page>
  );
}
