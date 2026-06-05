import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  projects,
  projectFiles,
  projectComments,
  projectBomItems,
  projectCircuits,
  projectPhotos,
  files,
  fileAssets,
  users,
  purchases,
} from "@/lib/db/schema";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { Card, CardContent } from "@/components/ui/card";
import { ExpandableDescription } from "@/components/ui/expandable-description";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DeleteProjectButton } from "@/components/projects/delete-project-button";
import { BomDisplay } from "@/components/projects/bom-display";
import { EditBomDialog } from "@/components/projects/edit-bom-dialog";
import { EditProjectDialog } from "@/components/projects/edit-project-dialog";
import {
  ProjectTabs,
  type ProjectTab,
} from "@/components/projects/project-tabs";
import { AddProjectFilesDialog } from "@/components/projects/add-project-files-dialog";
import { FileThumbnailStack } from "@/components/projects/file-thumbnail-stack";
import { BuildGuide } from "@/components/projects/build-guide";
import {
  CircuitGallery,
  type CircuitTile,
} from "@/components/circuits/circuit-gallery";
import { Code } from "@/components/icons/code";
import { Pencil } from "@/components/icons/pencil";
import { Trash } from "@/components/icons/trash";
import { projectJsonLd } from "@/lib/seo/json-ld";
import { PurchaseButton } from "@/components/purchase/purchase-button";
import { PayoutSetupWarning } from "@/components/payouts/payout-setup-warning";
import {
  CommentsSection,
  type CommentRow,
  type PhotoPost,
} from "@/components/comments/comments-section";
import {
  PhotosFeed,
  type FeedPhoto,
} from "@/components/photos/photos-feed";
import { userOwnsProject } from "@/lib/entitlement";
import { isOrgMember } from "@/lib/authorization";
import { listProjectCollaborators } from "@/app/actions/projects";
import { ProjectCollaborators } from "@/components/projects/project-collaborators";
import { swallow } from "@/lib/utils/swallow";

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

// Bounding-box label matching the file cards elsewhere (library /
// profile): "40.0 × 30.0 × 20.0 mm".
function dimensionsLabel(
  dims: [number, number, number] | null
): string | null {
  if (!dims) return null;
  const fmt = (n: number) => n.toFixed(1);
  return `${fmt(dims[0])} × ${fmt(dims[1])} × ${fmt(dims[2])} mm`;
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const [row] = await db
    .select({
      name: projects.name,
      description: projects.description,
      thumbnailUrl: projects.thumbnailUrl,
      status: projects.status,
      visibility: projects.visibility,
      displayName: users.displayName,
      username: users.username,
    })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(projects.slug, slug));

  if (!row || row.status !== "published" || row.visibility !== "public") {
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  const creator = row.displayName || row.username || "a Materialize creator";
  const description = truncate(
    row.description?.trim() || `A 3D-print project by ${creator}.`,
    155
  );
  const url = `/projects/${slug}`;

  // og:image / twitter:image are emitted by opengraph-image.tsx in
  // this segment — leave them off here to avoid duplicate tags.
  return {
    title: row.name,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: row.name,
      description,
      url,
      authors: row.displayName ? [row.displayName] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: row.name,
      description,
    },
  };
}

export default async function ProjectDetailPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const { userId } = await auth();

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      buildGuide: projects.buildGuide,
      slug: projects.slug,
      price: projects.price,
      license: projects.license,
      status: projects.status,
      visibility: projects.visibility,
      tags: projects.tags,
      designTags: projects.designTags,
      thumbnailUrl: projects.thumbnailUrl,
      repoUrl: projects.repoUrl,
      coverPhotoId: projects.coverPhotoId,
      downloadCount: projects.downloadCount,
      createdAt: projects.createdAt,
      userId: projects.userId,
      organizationId: projects.organizationId,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      ownerOnboarded: users.stripeOnboardingComplete,
    })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(projects.slug, slug));

  if (!project) notFound();
  // "Owner" here means write-access for visibility purposes — covers
  // the personal owner AND any member of the org that owns the
  // project. Same shape as the file detail page.
  const isOwner =
    !!userId &&
    (userId === project.userId ||
      (project.organizationId !== null &&
        (await isOrgMember(userId, project.organizationId)).member));
  if (
    !isOwner &&
    (project.status !== "published" || project.visibility !== "public")
  ) {
    notFound();
  }

  // Eight independent reads — fan out in one roundtrip. Photo URL
  // signing has to wait on its row fetch and is handled separately
  // below. `userOwnsProject` is called once and reused for both the
  // download gate and the build-post gate — same query, same answer.
  const [
    bundledFiles,
    ownsProject,
    curatorRows,
    buildRows,
    circuitRows,
    bomItems,
    commentRows,
    collaborators,
  ] = await Promise.all([
    db
      .select({
        id: files.id,
        name: files.name,
        slug: files.slug,
        thumbnailUrl: files.thumbnailUrl,
        price: files.price,
        position: projectFiles.position,
      })
      .from(projectFiles)
      .innerJoin(files, eq(projectFiles.fileId, files.id))
      .where(eq(projectFiles.projectId, project.id))
      .orderBy(asc(projectFiles.position)),
    userOwnsProject(userId, project.id),
    // Curator gallery photos for the project — the owner's
    // hand-picked images that aren't the cover. Same shape as the
    // file detail page, mapped through PhotosFeed. swallow()ed so a
    // Neon hiccup never 500s the listing.
    swallow(
      db
        .select({
          id: projectPhotos.id,
          caption: projectPhotos.caption,
          createdAt: projectPhotos.createdAt,
          storageKey: projectPhotos.storageKey,
        })
        .from(projectPhotos)
        .where(
          and(
            eq(projectPhotos.projectId, project.id),
            eq(projectPhotos.kind, "creator")
          )
        )
        .orderBy(asc(projectPhotos.sortOrder))
    ),
    // Community "builds" — interleaved with comments below. Limit 60
    // so a popular project doesn't push hundreds through the page.
    swallow(
      db
        .select({
          id: projectPhotos.id,
          storageKey: projectPhotos.storageKey,
          caption: projectPhotos.caption,
          createdAt: projectPhotos.createdAt,
          authorId: users.id,
          authorUsername: users.username,
          authorDisplayName: users.displayName,
          authorAvatarUrl: users.avatarUrl,
        })
        .from(projectPhotos)
        .innerJoin(users, eq(projectPhotos.userId, users.id))
        .where(
          and(
            eq(projectPhotos.projectId, project.id),
            eq(projectPhotos.kind, "build")
          )
        )
        .orderBy(desc(projectPhotos.createdAt))
        .limit(60)
    ),
    // Circuit / wiring diagrams — paired with the BOM as the "how
    // it goes together electrically" half of the assembly story.
    // Empty + non-owner → the section header is skipped entirely;
    // owner sees an inline uploader to seed the first one.
    swallow(
      db
        .select({
          id: projectCircuits.id,
          kind: projectCircuits.kind,
          caption: projectCircuits.caption,
          previewStorageKey: projectCircuits.previewStorageKey,
          sourceStorageKey: projectCircuits.sourceStorageKey,
          externalUrl: projectCircuits.externalUrl,
        })
        .from(projectCircuits)
        .where(eq(projectCircuits.projectId, project.id))
        .orderBy(asc(projectCircuits.sortOrder))
    ),
    // BOM — the project's bill of materials, in display order. Empty
    // for most projects; the page only renders the section when items
    // exist (progressive disclosure).
    swallow(
      db
        .select({
          id: projectBomItems.id,
          name: projectBomItems.name,
          quantity: projectBomItems.quantity,
          unit: projectBomItems.unit,
          notes: projectBomItems.notes,
          sourceUrl: projectBomItems.sourceUrl,
        })
        .from(projectBomItems)
        .where(eq(projectBomItems.projectId, project.id))
        .orderBy(asc(projectBomItems.sortOrder))
    ),
    // Comments — same query shape as on the file detail page. Pull
    // every row (top-level + replies) ordered chronologically; the
    // renderer splits into threads via parentId. swallow() so a
    // transient Neon blip doesn't 500 the page.
    swallow(
      db
        .select({
          id: projectComments.id,
          parentId: projectComments.parentId,
          body: projectComments.body,
          deletedAt: projectComments.deletedAt,
          createdAt: projectComments.createdAt,
          updatedAt: projectComments.updatedAt,
          authorId: users.id,
          authorUsername: users.username,
          authorDisplayName: users.displayName,
          authorAvatarUrl: users.avatarUrl,
        })
        .from(projectComments)
        .innerJoin(users, eq(projectComments.userId, users.id))
        .where(eq(projectComments.projectId, project.id))
        .orderBy(asc(projectComments.createdAt))
        .limit(500)
    ),
    listProjectCollaborators(project.id),
  ]);
  const canDownload = ownsProject;
  // Gate for project builds / inline-comment photos. Owner is always
  // covered because `userOwnsProject` returns true for the creator's
  // own project — so reuse the same answer instead of querying twice.
  const canPostBuild = ownsProject;

  // Sign R2 URLs for both photo galleries in parallel.
  const [curatorPhotos, buildsWithUrls]: [FeedPhoto[], PhotoPost[]] =
    await Promise.all([
      Promise.all(
        curatorRows.map(async (row) => ({
          id: row.id,
          caption: row.caption,
          createdAt: row.createdAt,
          kind: "creator" as const,
          author: null,
          downloadUrl: await generateDownloadUrl(row.storageKey, 3600),
        }))
      ),
      Promise.all(
        buildRows.map(async (row) => ({
          id: row.id,
          caption: row.caption,
          createdAt: row.createdAt,
          downloadUrl: await generateDownloadUrl(row.storageKey, 3600),
          author: {
            id: row.authorId,
            username: row.authorUsername,
            displayName: row.authorDisplayName,
            avatarUrl: row.authorAvatarUrl,
          },
        }))
      ),
    ]);
  // Filter out malformed rows: every row must carry something
  // renderable — a preview image (image kinds), a source file the
  // lightbox can render live (kicad / fritzing / gerber), or an
  // external URL (wokwi_url).
  const circuits: CircuitTile[] = circuitRows
    .filter(
      (row) => row.previewStorageKey || row.sourceStorageKey || row.externalUrl
    )
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      caption: row.caption,
      externalUrl: row.externalUrl,
      previewUrl: row.previewStorageKey
        ? `/api/circuits/${row.id}/preview`
        : "",
      sourceUrl: row.sourceStorageKey
        ? `/api/circuits/${row.id}/source`
        : null,
    }));

  const comments: CommentRow[] = commentRows.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    body: row.deletedAt ? "" : row.body,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    author: {
      id: row.authorId,
      username: row.authorUsername,
      displayName: row.authorDisplayName,
      avatarUrl: row.authorAvatarUrl,
    },
  }));

  // Primary asset per bundled file — gives the "Files in this project"
  // grid the same name + dimensions treatment as file cards elsewhere.
  // The display name prefers the user-entered file name and falls back
  // to the original upload filename (files auto-created by the print
  // flow can land with an empty name). Mirrors the primary-asset pick
  // in library-tab: first asset by createdAt.
  const bundledFileIds = bundledFiles.map((f) => f.id);
  const fileAssetRows = bundledFileIds.length
    ? await db
        .select({
          fileId: fileAssets.fileId,
          originalFilename: fileAssets.originalFilename,
          geometryData: fileAssets.geometryData,
        })
        .from(fileAssets)
        .where(inArray(fileAssets.fileId, bundledFileIds))
        .orderBy(asc(fileAssets.createdAt))
    : [];
  const primaryAssetByFileId = new Map<
    string,
    { originalFilename: string; dimensions: [number, number, number] | null }
  >();
  for (const a of fileAssetRows) {
    if (!a.fileId || primaryAssetByFileId.has(a.fileId)) continue;
    const dims = a.geometryData?.dimensions;
    const dimsOk =
      dims &&
      typeof dims.x === "number" &&
      typeof dims.y === "number" &&
      typeof dims.z === "number";
    primaryAssetByFileId.set(a.fileId, {
      originalFilename: a.originalFilename,
      dimensions: dimsOk ? [dims.x, dims.y, dims.z] : null,
    });
  }
  const bundledFileCards = bundledFiles.map((file) => {
    const asset = primaryAssetByFileId.get(file.id);
    return {
      ...file,
      displayName:
        file.name?.trim() || asset?.originalFilename || "Untitled file",
      dimensions: asset?.dimensions ?? null,
    };
  });

  let ownerBuyerCount = 0;
  // Files the viewer owns that aren't already bundled here — feeds the
  // "Add files" picker. Owner-only; only the viewer's own files are
  // offered (addFilesToProject re-validates attachability server-side).
  let availableFilesToAdd: Array<{
    id: string;
    name: string;
    thumbnailUrl: string | null;
  }> = [];
  if (isOwner && userId) {
    const [buyerRows, ownFiles] = await Promise.all([
      db
        .select({ id: purchases.id })
        .from(purchases)
        .where(
          and(
            eq(purchases.projectId, project.id),
            eq(purchases.status, "completed")
          )
        ),
      db
        .select({
          id: files.id,
          name: files.name,
          thumbnailUrl: files.thumbnailUrl,
        })
        .from(files)
        .where(eq(files.userId, userId))
        .orderBy(desc(files.createdAt)),
    ]);
    ownerBuyerCount = buyerRows.length;
    const bundledIds = new Set(bundledFiles.map((f) => f.id));
    availableFilesToAdd = ownFiles.filter((f) => !bundledIds.has(f.id));
  }

  // JSON-LD for crawlers — emitted only for the public, indexable
  // form (published + public). Mirrors the gate used for the page-
  // level visibility check above so Google never sees a graph entry
  // for a draft or private project.
  const jsonLd =
    project.status === "published" && project.visibility === "public"
      ? projectJsonLd({
          slug: project.slug,
          name: project.name,
          description: project.description,
          thumbnailUrl: project.thumbnailUrl,
          license: project.license,
          price: project.price,
          createdAt: project.createdAt,
          author: {
            username: project.username,
            displayName: project.displayName,
            avatarUrl: project.avatarUrl,
          },
          fileSlugs: bundledFiles.map((f) => f.slug),
        })
      : null;

  // Content tabs that sit under the cover/photos and above the
  // Discussion section. Order is fixed — Files, Build Guide, BOM,
  // Wiring — and each tab is only included when it has something to
  // show (always for owners, who get the inline editors / empty
  // states). The first entry is the default selection, so Files
  // (always present) anchors it.
  const tabs: ProjectTab[] = [];

  tabs.push({
    value: "files",
    label: "Files",
    meta: bundledFiles.length,
    content: (
      <div>
        {isOwner && (
          <div className="mb-3 flex items-center justify-end">
            <AddProjectFilesDialog
              projectId={project.id}
              availableFiles={availableFilesToAdd}
            />
          </div>
        )}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
          {bundledFileCards.map((file) => {
            const dims = dimensionsLabel(file.dimensions);
            return (
              <Link
                key={file.id}
                href={`/files/${file.slug}`}
                className="group flex flex-col gap-2"
              >
                <div className="aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                  {file.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={file.thumbnailUrl}
                      alt=""
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground/50">
                      No preview
                    </div>
                  )}
                </div>
                <div>
                  <p className="truncate text-sm font-medium transition-colors group-hover:text-primary">
                    {file.displayName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {dims ??
                      (file.price > 0
                        ? `$${(file.price / 100).toFixed(2)}`
                        : "Free")}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    ),
  });

  // Build guide — owner-authored markdown with inline step photos.
  // Owners always get the tab (with the inline editor / empty-state
  // prompt); non-owners only once a guide exists.
  if (project.buildGuide || isOwner) {
    tabs.push({
      value: "build-guide",
      label: "Build Guide",
      content: (
        <BuildGuide
          projectId={project.id}
          buildGuide={project.buildGuide}
          canManage={isOwner}
        />
      ),
    });
  }

  // Bill of materials — the additional parts a builder needs beyond
  // the printed files. Owners always get the tab (the editor lives
  // here now, not the sidebar); non-owners only once items exist.
  if (bomItems.length > 0 || isOwner) {
    tabs.push({
      value: "bom",
      label: "BOM",
      meta: bomItems.length || undefined,
      content: (
        <div className="space-y-3">
          {isOwner && (
            <div className="flex justify-end">
              <EditBomDialog
                projectId={project.id}
                initial={bomItems.map((it) => ({
                  name: it.name,
                  quantity: String(it.quantity),
                  unit: it.unit ?? "",
                  notes: it.notes ?? "",
                  sourceUrl: it.sourceUrl ?? "",
                }))}
                trigger={
                  <Button variant="outline" size="sm">
                    {bomItems.length > 0
                      ? "Edit BOM"
                      : "Add a Bill of Materials"}
                  </Button>
                }
              />
            </div>
          )}
          {bomItems.length > 0 ? (
            <BomDisplay items={bomItems} />
          ) : (
            <p className="text-sm text-muted-foreground">
              No bill of materials yet.
            </p>
          )}
        </div>
      ),
    });
  }

  // Wiring / circuit diagrams — owners always get the tab (uploader
  // inline when empty); non-owners only once a diagram exists.
  if (circuits.length > 0 || isOwner) {
    tabs.push({
      value: "wiring",
      label: "Wiring",
      meta: circuits.length || undefined,
      content: (
        <CircuitGallery
          projectId={project.id}
          circuits={circuits}
          canManage={isOwner}
        />
      ),
    });
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-3 lg:items-start">
        {/* Title — order-1 mobile, col-span-2 row-1 desktop. The
            action card slots between this and the main flow on
            mobile (order-2) so the buyer sees price/Purchase
            before the long file grid + comments. */}
        <div className="order-1 lg:col-span-2">
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Project
            <span className="mx-1.5">·</span>
            {bundledFiles.length}{" "}
            {bundledFiles.length === 1 ? "file" : "files"}
          </p>
        </div>

        {/* Main content — order-3 on mobile, row 2 cols 1-2 on
            desktop via auto-flow. */}
        <div className="order-3 space-y-6 lg:col-span-2">
          {(() => {
            // Resolve the cover in priority order:
            //   1. coverPhotoId pick OR any curator photo (the proxy
            //      route resolves an explicit pick first, otherwise
            //      falls back to the first uploaded photo). The `?v=`
            //      pins the optimizer cache to the current pick so a
            //      re-pick shows immediately instead of the stale
            //      max-age=300 copy.
            //   2. legacy thumbnailUrl column (full URL set at
            //      project create time)
            //   3. cute stack of the bundled files' thumbnails
            //   4. placeholder
            const hasProxyCover =
              !!project.coverPhotoId || curatorPhotos.length > 0;
            const coverSrc = hasProxyCover
              ? `/api/thumbnails/projects/${project.id}?v=${
                  project.coverPhotoId ?? curatorPhotos[0]?.id ?? "auto"
                }`
              : project.thumbnailUrl;
            const fileThumbs = bundledFiles
              .map((f) => f.thumbnailUrl)
              .filter((u): u is string => !!u);
            if (coverSrc) {
              return (
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/10">
                  <Image
                    src={coverSrc}
                    alt={project.name}
                    fill
                    priority
                    sizes="(max-width: 1024px) 100vw, 66vw"
                    className="object-cover"
                  />
                </div>
              );
            }
            if (fileThumbs.length > 0) {
              return (
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/10">
                  <FileThumbnailStack thumbnails={fileThumbs} />
                </div>
              );
            }
            return (
              <div className="aspect-[4/3] rounded-2xl bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                <span className="text-xs text-muted-foreground/50">
                  No cover image
                </span>
              </div>
            );
          })()}

          {project.description && (
            <ExpandableDescription source={project.description} />
          )}

          {/* Curator photos — the project's gallery, separate from
              the cover image. Mirrors the file detail page: section
              renders for non-owners only when at least one photo
              exists, while owners always see the section with an
              inline uploader to seed the first one. */}
          {(curatorPhotos.length > 0 || isOwner) && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold">Photos</h2>
              <PhotosFeed
                photos={curatorPhotos}
                targetType="project"
                targetId={project.id}
                ownerId={project.userId}
                viewerId={userId}
                uploadAs={isOwner ? "creator" : null}
              />
            </div>
          )}

          {/* Search tags + design-tag "Print Recommendations" card
              intentionally don't render publicly — they're indexing
              metadata, not creator-facing copy. Same as the file
              detail page. */}

          {/* Content tabs — Files, Build Guide, BOM, Wiring. Sit
              between the cover/photos and the Discussion section.
              Built above; each tab carries its own inline editor and
              empty state for owners. */}
          <ProjectTabs tabs={tabs} />

          {/* Comments — public discussion. Wrapped in a Card here
              because CommentsSection itself renders bare (the file
              detail page combines it with photos under a single
              "Discussion" Card). */}
          <Card>
            <CardContent className="space-y-5">
              <h2 className="text-base font-semibold">Discussion</h2>
              <CommentsSection
                target="project"
                targetId={project.id}
                comments={comments}
                photoPosts={buildsWithUrls}
                ownerId={project.userId}
                viewerId={userId}
                isSignedIn={!!userId}
                signInRedirect={`/projects/${slug}`}
                acceptPhoto={!!userId && canPostBuild}
              />
            </CardContent>
          </Card>
        </div>

        {/* Action card — order-2 mobile (between title and main), col-3
            spanning rows 1-2 on desktop with sticky positioning so it
            stays in view while the user scrolls comments / file grid. */}
        <div className="order-2 space-y-4 lg:col-start-3 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                {project.avatarUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={project.avatarUrl}
                    alt=""
                    className="h-10 w-10 rounded-full"
                  />
                )}
                <div>
                  <Link
                    href={`/${project.username}`}
                    className="font-medium text-sm hover:underline"
                  >
                    {project.displayName || project.username}
                  </Link>
                </div>
              </div>

              <Separator className="my-4" />

              {project.price > 0 ? (
                <>
                  <p className="text-2xl font-bold">
                    ${(project.price / 100).toFixed(2)}
                  </p>
                  {isOwner && !project.ownerOnboarded && (
                    <div className="mt-3">
                      <PayoutSetupWarning />
                    </div>
                  )}
                  {canDownload ? (
                    <p className="text-xs text-muted-foreground mt-3">
                      Download files individually below.
                    </p>
                  ) : (
                    <PurchaseButton
                      projectId={project.id}
                      priceCents={project.price}
                      className="mt-3"
                    />
                  )}
                </>
              ) : (
                <>
                  <p className="text-lg font-medium text-muted-foreground">
                    Free
                  </p>
                  <p className="text-xs text-muted-foreground mt-3">
                    Download files individually below.
                  </p>
                </>
              )}

              {project.repoUrl && (
                <>
                  <Separator className="my-4" />
                  <Button
                    variant="outline"
                    className="w-full"
                    render={
                      <a
                        href={project.repoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Code size={14} />
                        View code
                      </a>
                    }
                  />
                </>
              )}

              <Separator className="my-4" />

              <div className="text-sm text-muted-foreground space-y-1">
                <p className="capitalize">License: {project.license}</p>
                <p>{bundledFiles.length} files in bundle</p>
              </div>

              <Separator className="my-4" />
              <ProjectCollaborators
                projectId={project.id}
                initial={collaborators.map((c) => ({
                  id: c.id,
                  username: c.username,
                  displayName: c.displayName,
                  avatarUrl: c.avatarUrl,
                }))}
                canManage={isOwner}
                viewerId={userId}
              />

              {isOwner && (
                <>
                  <Separator className="my-4" />
                  {/* Edit / delete as icon buttons, matching the file
                      detail page. BOM editing lives in the BOM tab now,
                      not here. */}
                  <div className="flex items-center gap-1">
                    <EditProjectDialog
                      projectId={project.id}
                      initial={{
                        name: project.name,
                        description: project.description,
                        tags: project.tags,
                        repoUrl: project.repoUrl,
                        coverPhotoId: project.coverPhotoId,
                        photos: curatorPhotos.map((p) => ({
                          id: p.id,
                          downloadUrl: p.downloadUrl,
                        })),
                      }}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon-lg"
                          className="rounded-[12px] p-2"
                          aria-label="Edit project"
                        >
                          <Pencil className="size-5" />
                        </Button>
                      }
                    />
                    <DeleteProjectButton
                      projectId={project.id}
                      projectName={project.name}
                      hasBuyers={ownerBuyerCount > 0}
                      buyerCount={ownerBuyerCount}
                      redirectTo={`/${project.username}`}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon-lg"
                          className="rounded-[12px] p-2 text-destructive hover:text-destructive"
                          aria-label="Delete project"
                        >
                          <Trash className="size-5" />
                        </Button>
                      }
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
