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
import { notUnsavedStudioDraft } from "@/lib/studio-drafts";
import { loadProjectBySlug } from "./loader";
import { generateDownloadUrl } from "@/lib/storage";
import { Card, CardContent } from "@/components/ui/card";
import { ExpandableDescription } from "@/components/ui/expandable-description";
import { Button } from "@/components/ui/button";
import { Download } from "@/components/icons/download";
import { Print } from "@/components/icons/print";
import { OwnerBar } from "@/components/ui/owner-bar";
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
import { BuildGuideReader } from "@/components/projects/build-guide-reader";
import {
  CircuitGallery,
  type CircuitTile,
} from "@/components/circuits/circuit-gallery";
import { LicenseBadge } from "@/components/licenses/license-badge";
import { getCategoryLabel } from "@/lib/categories";
import { SourceCodeCard } from "@/components/projects/source-code-card";
import { CardImageCarousel } from "@/components/photos/card-image-carousel";
import { projectJsonLd, safeJsonLdScript } from "@/lib/seo/json-ld";
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
import { canWriteProject, isOrgMember } from "@/lib/authorization";
import { listProjectCollaborators } from "@/app/actions/projects";
import { ProjectCollaborators } from "@/components/projects/project-collaborators";
import { UserAvatar } from "@/components/auth/user-avatar";
import { swallow } from "@/lib/utils/swallow";
import { resolveProjectVisibility } from "./access";
import {
  FileCard,
  FileCardPriceBadge,
  formatFileDimensions,
} from "@/components/files/file-card";

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const row = await loadProjectBySlug(slug);

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

  // React.cache deduplicates this call with the one in generateMetadata
  // for the same slug on the same request — one DB round-trip total.
  const project = await loadProjectBySlug(slug);

  if (!project) notFound();
  // "Owner" here means the strict owner-lifecycle set — the personal
  // owner AND any member of the org that owns the project. Reserved
  // for destructive / ownership controls (delete, metadata edit,
  // collaborator management) — see canWrite below for content-editing
  // access, which additionally admits per-project collaborators.
  const isOwner =
    !!userId &&
    (userId === project.userId ||
      (project.organizationId !== null &&
        (await isOrgMember(userId, project.organizationId)).member));
  // Write access for CONTENT — owner, org member, or per-project
  // collaborator (canWriteProject folds all three into one check).
  // Collaborators edit content; only isOwner owns lifecycle.
  const canWrite = userId
    ? (await canWriteProject(userId, project.id)).ok
    : false;
  if (
    !resolveProjectVisibility({
      status: project.status,
      visibility: project.visibility,
      canWrite,
    })
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
  // "Add files" picker. Gated on canWrite (not isOwner) so a
  // collaborator's own files populate the picker too; only the
  // viewer's own files are offered (addFilesToProject re-validates
  // attachability server-side).
  let availableFilesToAdd: Array<{
    id: string;
    name: string;
    thumbnailUrl: string | null;
  }> = [];
  if (canWrite && userId) {
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
        // "Add file" picker: unsaved text-to-CAD drafts stay
        // studio-only (docs/text-to-cad/05 §B).
        .where(and(eq(files.userId, userId), notUnsavedStudioDraft()))
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
        {canWrite && (
          <div className="mb-3 flex items-center justify-end">
            <AddProjectFilesDialog
              projectId={project.id}
              availableFiles={availableFilesToAdd}
            />
          </div>
        )}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
          {bundledFileCards.map((file) => (
            <FileCard
              key={file.id}
              href={`/files/${file.slug}`}
              title={file.displayName}
              thumbnailUrl={file.thumbnailUrl}
              placeholder="No preview"
              overlay={<FileCardPriceBadge priceCents={file.price} />}
              subtitle={formatFileDimensions(file.dimensions)}
            />
          ))}
        </div>
      </div>
    ),
  });

  // Build guide — owner/collaborator-authored HTML with chapters +
  // inline media. Read-only here; editing happens on the focused
  // /build-guide/edit page (already collaborator-gated). Content
  // editors (canWrite) always get the tab (with the empty-state
  // prompt + edit link); everyone else only once a guide exists.
  if (project.buildGuide || canWrite) {
    tabs.push({
      value: "build-guide",
      label: "Build Guide",
      content: (
        <div className="space-y-3">
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              render={
                <Link href={`/projects/${project.slug}/build-guide/edit`} />
              }
            >
              {project.buildGuide ? "Edit build guide" : "Write build guide"}
            </Button>
          )}
          {project.buildGuide ? (
            <BuildGuideReader html={project.buildGuide} />
          ) : (
            canWrite && (
              <p className="text-sm text-muted-foreground">
                Document how to build this project — steps, photos, wiring
                notes, code snippets. Organize it into chapters and add
                image galleries.
              </p>
            )
          )}
        </div>
      ),
    });
  }

  // Bill of materials — the additional parts a builder needs beyond
  // the printed files. Content editors (canWrite) always get the tab
  // (the editor lives here now, not the sidebar); everyone else only
  // once items exist.
  if (bomItems.length > 0 || canWrite) {
    tabs.push({
      value: "bom",
      label: "Components",
      meta: bomItems.length || undefined,
      content: (
        <div className="space-y-3">
          {canWrite && (
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
                      ? "Edit Components"
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

  // Wiring / circuit diagrams — content editors (canWrite) always get
  // the tab (uploader inline when empty); everyone else only once a
  // diagram exists.
  if (circuits.length > 0 || canWrite) {
    tabs.push({
      value: "wiring",
      label: "Wiring",
      meta: circuits.length || undefined,
      content: (
        <CircuitGallery
          projectId={project.id}
          circuits={circuits}
          canManage={canWrite}
        />
      ),
    });
  }

  // Gallery images for the single hero carousel — every curator photo,
  // cover-first. Uses the freshly-signed R2 URLs directly (same source
  // PhotosFeed renders), so the carousel and the gallery never drift.
  // Falls back to the legacy thumbnail / file-thumbnail stack when a
  // project predates curator photos.
  const galleryImages = [...curatorPhotos]
    .sort((a, b) => {
      if (!project.coverPhotoId) return 0;
      if (a.id === project.coverPhotoId) return -1;
      if (b.id === project.coverPhotoId) return 1;
      return 0;
    })
    .map((p) => p.downloadUrl);
  const fileThumbs = bundledFiles
    .map((f) => f.thumbnailUrl)
    .filter((u): u is string => !!u);

  // Purchase block for paid projects — rendered inline below the
  // gallery. Free projects omit this entirely (price is shown in the
  // header metadata line instead).
  const renderPurchasePanel = () => {
    if (project.price <= 0) return null;
    return (
      <>
        {isOwner && !project.ownerOnboarded && <PayoutSetupWarning />}
        {!canDownload && (
          <PurchaseButton
            projectId={project.id}
            priceCents={project.price}
            className="w-full"
          />
        )}
      </>
    );
  };

  // Author byline (avatar + name) — rendered in the mobile header and
  // again in the desktop sidebar. Same reasoning as the panel above.
  const renderByline = () => (
    <Link
      href={`/${project.username}`}
      className="flex w-fit items-center gap-1.5 hover:underline"
    >
      <UserAvatar
        seed={project.username || project.userId}
        imageUrl={project.avatarUrl}
        displayName={project.displayName || project.username}
        className="h-5 w-5"
      />
      <span className="text-sm text-muted-foreground">
        {project.displayName || project.username}
      </span>
    </Link>
  );

  // Owner edit/delete controls — text buttons in the OwnerBar.
  const renderOwnerControls = () => (
    <>
      <DeleteProjectButton
        projectId={project.id}
        projectName={project.name}
        hasBuyers={ownerBuyerCount > 0}
        buyerCount={ownerBuyerCount}
        redirectTo={`/${project.username}`}
        trigger={
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            aria-label="Delete project"
          >
            Delete
          </Button>
        }
      />
      <EditProjectDialog
        projectId={project.id}
        initial={{
          name: project.name,
          description: project.description,
          tags: project.tags,
          category: project.category,
          repoUrl: project.repoUrl,
          license: project.license,
          coverPhotoId: project.coverPhotoId,
          photos: curatorPhotos.map((p) => ({
            id: p.id,
            downloadUrl: p.downloadUrl,
          })),
        }}
        trigger={
          <Button variant="outline" size="sm" aria-label="Edit project">
            Edit
          </Button>
        }
      />
    </>
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdScript(jsonLd) }}
        />
      )}
      <div className="flex flex-col gap-8">
        {/* Admin-only bar — visibility status + owner controls, above
            all page content. Collaborators see the status only. */}
        {canWrite && (
          <OwnerBar
            visibility={project.visibility === "public" ? "public" : "private"}
          >
            {isOwner && renderOwnerControls()}
          </OwnerBar>
        )}

        {/* Hero — gallery left, project info right on md+ */}
        <div className="flex flex-col gap-6 md:grid md:grid-cols-[3fr_2fr] md:items-start md:gap-8">
          {/* Gallery */}
          <div>
            {galleryImages.length > 0 ? (
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/10">
                <CardImageCarousel
                  images={galleryImages}
                  alt={project.name}
                  size="lg"
                />
              </div>
            ) : project.thumbnailUrl ? (
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/10">
                <Image
                  src={project.thumbnailUrl}
                  alt={project.name}
                  fill
                  priority
                  sizes="(max-width: 768px) 100vw, 60vw"
                  className="object-cover"
                />
              </div>
            ) : fileThumbs.length > 0 ? (
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/10">
                <FileThumbnailStack thumbnails={fileThumbs} />
              </div>
            ) : (
              <div className="aspect-[4/3] rounded-2xl bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                <span className="text-xs text-muted-foreground/50">
                  No cover image
                </span>
              </div>
            )}
          </div>

          {/* Project info + actions */}
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-2xl font-bold">{project.name}</h1>
              <div className="mt-2">{renderByline()}</div>
              {project.category && getCategoryLabel(project.category) && (
                <div className="mt-3">
                  <Link
                    href={`/files?category=${project.category}`}
                    className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {getCategoryLabel(project.category)}
                  </Link>
                </div>
              )}
            </div>

            {renderPurchasePanel()}

            {/* Primary action row — same treatment as the file detail page
                (`app/(app)/files/[slug]/page.tsx`): tallest size in the
                system, filled on both, Print keeping `default` so it still
                wins the row. The glyphs match that page and the nav's Print
                entry; `Factory` is reserved for the manufacturer/vendor
                concept (vendor picker, production payment), not this CTA. */}
            {bundledFiles.length > 0 && (
              <div className="flex gap-2.5">
                <Button
                  variant="secondary"
                  size="xl"
                  className="min-w-0 flex-1 font-semibold"
                  render={<Link href="#project-files" />}
                >
                  <Download size={18} />
                  Download
                </Button>
                <Button
                  size="xl"
                  className="min-w-0 flex-1 font-semibold"
                  render={<Link href={`/print?project=${project.slug}`} />}
                >
                  <Print size={18} />
                  Print
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Content below the hero */}
        <div className="space-y-6">
          {project.description && (
            <ExpandableDescription source={project.description} />
          )}

          {isOwner && (
            <div className="space-y-2">
              <PhotosFeed
                photos={curatorPhotos}
                targetType="project"
                targetId={project.id}
                ownerId={project.userId}
                viewerId={userId}
                uploadAs="creator"
              />
            </div>
          )}

          {project.repoUrl && <SourceCodeCard repoUrl={project.repoUrl} />}

          <div id="project-files">
            <ProjectTabs tabs={tabs} />
          </div>

          {(collaborators.length > 0 || isOwner) && (
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
          )}

          <Card className="bg-muted/50">
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

          <div className="flex justify-center pt-2">
            <LicenseBadge license={project.license} />
          </div>
        </div>
      </div>
    </div>
  );
}
