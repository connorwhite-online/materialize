import { db } from "@/lib/db";
import {
  files,
  filePhotos,
  users,
  projects,
  projectFiles,
  collections,
  collectionItems,
} from "@/lib/db/schema";
import { eq, desc, ilike, and, or, sql, inArray } from "drizzle-orm";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/auth/user-avatar";
import { BrowseSearchBar } from "@/components/browse/browse-search-bar";
import { CardImageCarousel } from "@/components/photos/card-image-carousel";
import { Download } from "@/components/icons/download";
import { formatCompactCount } from "@/lib/utils/format-count";

const PER_SECTION = 24;
/**
 * Below this length we prefix-match (`x%`) instead of substring
 * (`%x%`) — the same threshold the live home search uses. Single-
 * char substring scans are pathologically wide; prefix is cheap.
 */
const PREFIX_ONLY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;

function escapeLikePattern(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Batch-fetch curator photos for a set of file ids, returning a
 * fileId → additionalPhotoIds map (cover photo excluded). Single
 * IN-array query keeps cost proportional to total photo count
 * rather than file count.
 */
async function fetchAdditionalPhotosByFile(
  rows: Array<{ id: string; coverPhotoId: string | null }>
): Promise<Map<string, string[]>> {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return new Map();
  const photos = await db
    .select({ id: filePhotos.id, fileId: filePhotos.fileId })
    .from(filePhotos)
    .where(
      and(
        inArray(filePhotos.fileId, ids),
        eq(filePhotos.kind, "creator")
      )
    )
    .orderBy(filePhotos.sortOrder);

  const grouped = new Map<string, string[]>();
  for (const p of photos) {
    if (!p.fileId) continue;
    const arr = grouped.get(p.fileId) ?? [];
    arr.push(p.id);
    grouped.set(p.fileId, arr);
  }

  // Strip the cover photo id from each list so the carousel's
  // first slot (the cover via /api/thumbnails/{id}) doesn't
  // duplicate.
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const all = grouped.get(row.id) ?? [];
    result.set(
      row.id,
      row.coverPhotoId ? all.filter((id) => id !== row.coverPhotoId) : all
    );
  }
  return result;
}

export default async function BrowsePage(props: {
  searchParams: Promise<{ q?: string }>;
}) {
  const searchParams = await props.searchParams;
  const rawQ = (searchParams.q ?? "").trim();
  const query =
    rawQ.length > 0 && rawQ.length <= MAX_QUERY_LENGTH ? rawQ : "";
  const pattern = query
    ? query.length < PREFIX_ONLY_LENGTH
      ? `${escapeLikePattern(query)}%`
      : `%${escapeLikePattern(query)}%`
    : null;

  // Idle state: just the recent files grid. Same DB cost as before,
  // identical layout below the bar.
  if (!pattern) {
    const recentFiles = await db
      .select({
        id: files.id,
        name: files.name,
        slug: files.slug,
        price: files.price,
        thumbnailUrl: files.thumbnailUrl,
        coverPhotoId: files.coverPhotoId,
        downloadCount: files.downloadCount,
        username: users.username,
        displayName: users.displayName,
      })
      .from(files)
      .innerJoin(users, eq(files.userId, users.id))
      .where(
        and(
          eq(files.status, "published"),
          eq(files.visibility, "public")
        )
      )
      .orderBy(desc(files.createdAt))
      .limit(PER_SECTION);

    const photosByFile = await fetchAdditionalPhotosByFile(recentFiles);
    const recentWithPhotos: FileRow[] = recentFiles.map((f) => ({
      ...f,
      additionalPhotoIds: photosByFile.get(f.id) ?? [],
    }));

    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex justify-center">
          <BrowseSearchBar />
        </div>
        <div className="mt-8">
          {recentWithPhotos.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">
              No files published yet
            </p>
          ) : (
            <FileGrid files={recentWithPhotos} />
          )}
        </div>
      </div>
    );
  }

  // Search state: four sections in parallel. Materials are intentionally
  // excluded — they have their own /materials page with rich filters.
  const [fileRows, projectRows, collectionRows, userRows] = await Promise.all([
    db
      .select({
        id: files.id,
        name: files.name,
        slug: files.slug,
        price: files.price,
        thumbnailUrl: files.thumbnailUrl,
        coverPhotoId: files.coverPhotoId,
        downloadCount: files.downloadCount,
        username: users.username,
        displayName: users.displayName,
      })
      .from(files)
      .innerJoin(users, eq(files.userId, users.id))
      .where(
        and(
          eq(files.status, "published"),
          eq(files.visibility, "public"),
          ilike(files.name, pattern)
        )
      )
      .orderBy(desc(files.createdAt))
      .limit(PER_SECTION),
    db
      .select({
        id: projects.id,
        slug: projects.slug,
        name: projects.name,
        thumbnailUrl: projects.thumbnailUrl,
        creatorUsername: users.username,
        creatorDisplayName: users.displayName,
        fileCount: sql<number>`cast(count(${projectFiles.fileId}) as int)`,
      })
      .from(projects)
      .innerJoin(users, eq(projects.userId, users.id))
      .leftJoin(projectFiles, eq(projectFiles.projectId, projects.id))
      .where(
        and(
          eq(projects.status, "published"),
          eq(projects.visibility, "public"),
          ilike(projects.name, pattern)
        )
      )
      .groupBy(
        projects.id,
        users.username,
        users.displayName,
        projects.createdAt
      )
      .orderBy(desc(projects.createdAt))
      .limit(PER_SECTION),
    db
      .select({
        id: collections.id,
        slug: collections.slug,
        name: collections.name,
        creatorUsername: users.username,
        creatorDisplayName: users.displayName,
        fileCount: sql<number>`cast(count(${collectionItems.fileId}) as int)`,
      })
      .from(collections)
      .innerJoin(users, eq(collections.userId, users.id))
      .leftJoin(
        collectionItems,
        eq(collectionItems.collectionId, collections.id)
      )
      .where(
        and(
          eq(collections.visibility, "public"),
          ilike(collections.name, pattern)
        )
      )
      .groupBy(
        collections.id,
        users.username,
        users.displayName,
        collections.createdAt
      )
      .orderBy(desc(collections.createdAt))
      .limit(PER_SECTION),
    db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(
        or(ilike(users.username, pattern), ilike(users.displayName, pattern))
      )
      .limit(PER_SECTION),
  ]);

  const photosByFile = await fetchAdditionalPhotosByFile(fileRows);
  const fileRowsWithPhotos: FileRow[] = fileRows.map((f) => ({
    ...f,
    additionalPhotoIds: photosByFile.get(f.id) ?? [],
  }));

  const totalHits =
    fileRows.length +
    projectRows.length +
    collectionRows.length +
    userRows.length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex justify-center">
        <BrowseSearchBar defaultValue={query} />
      </div>

      {totalHits === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-sm text-muted-foreground">
            No results for &ldquo;{query}&rdquo;
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {userRows.length > 0 && (
            <Section title="Creators">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {userRows.map((u) => (
                  <UserCard key={u.id} user={u} />
                ))}
              </div>
            </Section>
          )}

          {projectRows.length > 0 && (
            <Section title="Projects">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {projectRows.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            </Section>
          )}

          {collectionRows.length > 0 && (
            <Section title="Collections">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {collectionRows.map((c) => (
                  <CollectionCard key={c.id} collection={c} />
                ))}
              </div>
            </Section>
          )}

          {fileRowsWithPhotos.length > 0 && (
            <Section title="Files">
              <FileGrid files={fileRowsWithPhotos} />
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </div>
  );
}

interface FileRow {
  id: string;
  name: string;
  slug: string;
  price: number;
  thumbnailUrl: string | null;
  coverPhotoId: string | null;
  additionalPhotoIds: string[];
  downloadCount: number;
  username: string | null;
  displayName: string | null;
}

function FileGrid({ files }: { files: FileRow[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {files.map((file) => (
        <Link key={file.id} href={`/files/${file.slug}`}>
          <Card className="group gap-0 p-1 overflow-hidden transition-colors hover:border-primary/30">
            <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted to-muted/50">
              {file.thumbnailUrl && (
                <CardImageCarousel
                  images={[
                    file.thumbnailUrl,
                    ...file.additionalPhotoIds.map(
                      (id) => `/api/thumbnails/${file.id}?photoId=${id}`
                    ),
                  ]}
                  alt=""
                  size="sm"
                />
              )}
            </div>
            <CardContent className="p-2.5">
              <h3 className="truncate text-sm font-medium group-hover:text-primary transition-colors">
                {file.name}
              </h3>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {file.displayName || file.username || "Unknown"}
              </p>
              <div className="mt-1.5 flex items-center justify-between">
                {file.price > 0 ? (
                  <span className="text-xs font-medium tabular-nums">
                    ${(file.price / 100).toFixed(2)}
                  </span>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">
                    Free
                  </Badge>
                )}
                <span
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums"
                  aria-label={`${file.downloadCount} downloads`}
                  title={`${file.downloadCount} downloads`}
                >
                  <Download size={11} />
                  {formatCompactCount(file.downloadCount)}
                </span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  thumbnailUrl: string | null;
  creatorUsername: string | null;
  creatorDisplayName: string | null;
  fileCount: number;
}

function ProjectCard({ project }: { project: ProjectRow }) {
  return (
    <Link href={`/projects/${project.slug}`}>
      <Card className="group gap-0 p-1 overflow-hidden transition-colors hover:border-primary/30">
        <div className="aspect-square overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted to-muted/50">
          {project.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={project.thumbnailUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground/60">
              Project
            </div>
          )}
        </div>
        <CardContent className="p-2.5">
          <h3 className="truncate text-sm font-medium group-hover:text-primary transition-colors">
            {project.name}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {project.fileCount}{" "}
            {project.fileCount === 1 ? "file" : "files"}
            {(project.creatorDisplayName || project.creatorUsername) && " · "}
            {project.creatorDisplayName || project.creatorUsername || ""}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

interface CollectionRow {
  id: string;
  slug: string;
  name: string;
  creatorUsername: string | null;
  creatorDisplayName: string | null;
  fileCount: number;
}

function CollectionCard({ collection }: { collection: CollectionRow }) {
  return (
    <Link href={`/collections/${collection.slug}`}>
      <Card className="group gap-0 p-1 overflow-hidden transition-colors hover:border-primary/30">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted to-muted/50 text-xs text-muted-foreground/60">
          Collection
        </div>
        <CardContent className="p-2.5">
          <h3 className="truncate text-sm font-medium group-hover:text-primary transition-colors">
            {collection.name}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {collection.fileCount}{" "}
            {collection.fileCount === 1 ? "file" : "files"}
            {(collection.creatorDisplayName || collection.creatorUsername) &&
              " · "}
            {collection.creatorDisplayName ||
              collection.creatorUsername ||
              ""}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

interface UserRow {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

function UserCard({ user }: { user: UserRow }) {
  if (!user.username) return null;
  return (
    <Link href={`/u/${user.username}`}>
      <Card className="group gap-0 p-1 overflow-hidden transition-colors hover:border-primary/30">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted to-muted/50">
          <UserAvatar
            seed={user.username}
            imageUrl={user.avatarUrl}
            displayName={user.displayName || user.username}
            className="h-2/3 w-2/3 text-2xl"
          />
        </div>
        <CardContent className="p-2.5 text-center">
          <h3 className="truncate text-sm font-medium group-hover:text-primary transition-colors">
            {user.displayName || user.username}
          </h3>
          {user.displayName && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              @{user.username}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
