import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
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
  users,
  purchases,
} from "@/lib/db/schema";
import { eq, and, asc, desc } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { Card, CardContent } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ExpandableDescription } from "@/components/ui/expandable-description";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DeleteProjectButton } from "@/components/projects/delete-project-button";
import { BomDisplay } from "@/components/projects/bom-display";
import { EditBomDialog } from "@/components/projects/edit-bom-dialog";
import { EditProjectDialog } from "@/components/projects/edit-project-dialog";
import {
  CircuitGallery,
  type CircuitTile,
} from "@/components/circuits/circuit-gallery";
import { Code } from "@/components/icons/code";
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
import { swallow } from "@/lib/utils/swallow";

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
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
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      ownerOnboarded: users.stripeOnboardingComplete,
    })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(projects.slug, slug));

  if (!project) notFound();
  const isOwner = userId === project.userId;
  // Owner sees their own project regardless of status/visibility.
  // Non-owners need both: the project must be published AND public.
  // (Skipping the visibility check let private published projects leak
  // to anyone with the slug.)
  if (
    !isOwner &&
    (project.status !== "published" || project.visibility !== "public")
  ) {
    notFound();
  }

  // Seven independent reads — fan out in one roundtrip. Photo URL
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

  let ownerBuyerCount = 0;
  if (isOwner) {
    const buyerRows = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(
        and(
          eq(purchases.projectId, project.id),
          eq(purchases.status, "completed")
        )
      );
    ownerBuyerCount = buyerRows.length;
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
            //   1. coverPhotoId pick from the edit dialog → proxy
            //      route that signs a fresh R2 URL on each load
            //   2. legacy thumbnailUrl column (full URL set at
            //      project create time)
            //   3. placeholder
            const coverSrc = project.coverPhotoId
              ? `/api/thumbnails/projects/${project.id}`
              : project.thumbnailUrl;
            return coverSrc ? (
              <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverSrc}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
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

          {/* Wiring / circuit diagrams — the visual half of the
              assembly story. Sits above the BOM because builders
              typically read it left-to-right (what does it do? how
              do I wire it? what do I need to buy?). Owners always
              see this region (uploader inline when empty); non-
              owners only see it once a diagram exists. */}
          {(circuits.length > 0 || isOwner) && (
            <CollapsibleSection
              title="Wiring"
              meta={circuits.length || undefined}
              defaultOpen
            >
              <CircuitGallery
                projectId={project.id}
                circuits={circuits}
                canManage={isOwner}
              />
            </CollapsibleSection>
          )}

          {/* Bill of materials — sits below wiring because the BOM
              answers "what do I need to buy" after the user has seen
              the diagram. Hidden when empty; collapsed by default
              since the BOM can be long. */}
          {bomItems.length > 0 && (
            <CollapsibleSection
              title="Bill of Materials"
              meta={bomItems.length}
            >
              <BomDisplay items={bomItems} />
            </CollapsibleSection>
          )}

          <div>
            <h2 className="text-sm font-medium mb-3">
              Files in this project
            </h2>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
              {bundledFiles.map((file) => (
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
                  <p className="text-sm font-medium line-clamp-1">
                    {file.name}
                  </p>
                </Link>
              ))}
            </div>
          </div>

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
                    href={`/u/${project.username}`}
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

              {isOwner && (
                <>
                  <Separator className="my-4" />
                  <div className="space-y-2">
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
                    />
                    <EditBomDialog
                      projectId={project.id}
                      initial={bomItems.map((it) => ({
                        name: it.name,
                        quantity: String(it.quantity),
                        unit: it.unit ?? "",
                        notes: it.notes ?? "",
                        sourceUrl: it.sourceUrl ?? "",
                      }))}
                    />
                    <DeleteProjectButton
                      projectId={project.id}
                      projectName={project.name}
                      hasBuyers={ownerBuyerCount > 0}
                      buyerCount={ownerBuyerCount}
                      redirectTo={`/u/${project.username}`}
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
