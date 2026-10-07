import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  files,
  fileAssets,
  fileDownloads,
  fileComments,
  users,
  purchases,
  filePhotos,
  projects,
  projectFiles,
  cartItems,
  printOrders,
  printOrderItems,
} from "@/lib/db/schema";
import { eq, and, asc, desc, inArray, count } from "drizzle-orm";
import { loadFileBySlug, loadPreviewView } from "./loader";
import { pickCurrentAsset } from "@/lib/files/current-version";
import { ownsLoadedFile, userHasUsedFile } from "@/lib/entitlement";
import { isOrgMember } from "@/lib/authorization";
import { OwnerBar } from "@/components/ui/owner-bar";
import { ExpandableDescription } from "@/components/ui/expandable-description";
import { Button } from "@/components/ui/button";
import { Download } from "@/components/icons/download";
import { Print } from "@/components/icons/print";
import {
  PhotosFeed,
  type FeedPhoto,
} from "@/components/photos/photos-feed";
import { DeleteFileButton } from "@/components/files/delete-file-button";
import { StepDownloadLink } from "@/components/files/step-download-button";
import { EditFileButton } from "@/components/files/edit-file-button";
import { FileThumbnailGeneratorLazy } from "@/components/files/file-thumbnail-generator-lazy";
import { FilePreview } from "@/components/files/file-preview";

import { VerifyingPill } from "@/components/files/verifying-pill";
import { ListingFlaggedBanner } from "@/components/files/listing-flagged-banner";
import {
  FileActivity,
  type DownloadActivity,
  type PrintActivity,
} from "@/components/files/file-activity";
import {
  CommentsSection,
  type CommentRow,
} from "@/components/comments/comments-section";
import { UserAvatar } from "@/components/auth/user-avatar";
import { getLicenseMeta } from "@/lib/licenses";
import { DetailList, DetailRow, formatMm } from "@/components/files/detail-list";
import { getCategoryLabel } from "@/lib/categories";
import { getMaterialById } from "@/lib/materials";
import { findMaterialConfig, getCraftCloudCatalog } from "@/lib/craftcloud/catalog";
import { generateDownloadUrl } from "@/lib/storage";
import { PRINTED_STATUSES, ACTIVE_ORDER_STATUSES } from "@/lib/print-statuses";
import { swallow } from "@/lib/utils/swallow";
import { fileJsonLd, safeJsonLdScript } from "@/lib/seo/json-ld";
import { PurchaseButton } from "@/components/purchase/purchase-button";
import { PayoutSetupWarning } from "@/components/payouts/payout-setup-warning";

async function buildMaterialLabel(configId: string | null): Promise<string | null> {
  if (!configId) return null;
  const entry = await findMaterialConfig(configId);
  if (!entry) return null;
  const color = entry.config.color || entry.config.originalColorName;
  return [entry.material.name, color].filter(Boolean).join(" ") || null;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const row = await loadFileBySlug(slug);

  if (!row || row.status !== "published") {
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  const creator = row.displayName || row.username || "a Materialize creator";
  const description = truncate(
    row.description?.trim() || `3D printable file by ${creator}.`,
    155
  );
  const url = `/files/${slug}`;

  // og:image and twitter:image come from the colocated
  // opengraph-image.tsx file convention — don't set them here or
  // Next emits duplicate tags.
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

export default async function FileDetailPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const { userId } = await auth();

  // React.cache deduplicates this call with the one in generateMetadata
  // for the same slug on the same request — one DB round-trip total.
  const file = await loadFileBySlug(slug);

  // Visible to anyone if published & public; visible to writers
  // (creator or org member) regardless of status / visibility. The
  // "writer" branch covers org-private drafts so any team member can
  // see them, not just the original uploader.
  if (!file) notFound();

  // Loaded separately from the file row on purpose — see
  // `loadPreviewView`. Null whenever the file is still on the
  // automatic head-on capture, and also whenever the read fails, so a
  // schema that lags a deploy costs the camera angle rather than the
  // page.
  const previewView = await loadPreviewView(file.id);

  const viewerCanWrite =
    !!userId &&
    (userId === file.userId ||
      (file.organizationId !== null &&
        (await isOrgMember(userId, file.organizationId)).member));
  const viewerIsOwner = viewerCanWrite;
  if (file.status !== "published" && !viewerCanWrite) notFound();
  if (file.visibility === "private" && !viewerCanWrite) notFound();

  // These five reads only depend on file.id / userId and don't
  // depend on each other — fan them out in one roundtrip instead of
  // five sequential awaits. Photo URL signing still has to wait for
  // its row fetch, so it runs after.
  const [assets, photos, buildRows, canPostBuild, canDownload, parentProject] =
    await Promise.all([
      db.select().from(fileAssets).where(eq(fileAssets.fileId, file.id)),
      db
        .select()
        .from(filePhotos)
        .where(
          and(eq(filePhotos.fileId, file.id), eq(filePhotos.kind, "creator"))
        )
        .orderBy(asc(filePhotos.sortOrder)),
      // Community builds — joined to users for poster identity. R2
      // URLs are signed at request time same as curator photos. Limit
      // to 60 so a popular file doesn't push 500 builds through the
      // page.
      db
        .select({
          id: filePhotos.id,
          storageKey: filePhotos.storageKey,
          caption: filePhotos.caption,
          createdAt: filePhotos.createdAt,
          authorId: users.id,
          authorUsername: users.username,
          authorDisplayName: users.displayName,
          authorAvatarUrl: users.avatarUrl,
        })
        .from(filePhotos)
        .innerJoin(users, eq(filePhotos.userId, users.id))
        .where(
          and(eq(filePhotos.fileId, file.id), eq(filePhotos.kind, "build"))
        )
        .orderBy(desc(filePhotos.createdAt))
        .limit(60),
      // Gates the "Share your build" affordance. Owners can also
      // share — they're a user too — but we still call the helper to
      // be uniform. The helper returns false for anon viewers without
      // a roundtrip.
      userHasUsedFile(userId, file.id),
      ownsLoadedFile(userId, {
        id: file.id,
        price: file.price,
        userId: file.userId,
        organizationId: file.organizationId,
      }),
      db
        .select({ id: projects.id, name: projects.name, slug: projects.slug })
        .from(projectFiles)
        .innerJoin(projects, eq(projectFiles.projectId, projects.id))
        .where(eq(projectFiles.fileId, file.id))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);

  // Sign R2 URLs in parallel for both gallery sources.
  const [photosWithUrls, buildsWithUrls] = await Promise.all([
    Promise.all(
      photos.map(async (photo) => ({
        id: photo.id,
        caption: photo.caption,
        createdAt: photo.createdAt,
        downloadUrl: await generateDownloadUrl(photo.storageKey, 3600),
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

  const isOwner = viewerIsOwner;

  // Owner needs to know whether deleting will hard-delete or soft-
  // archive. Soft-archive triggers when ANY of the following references
  // the file:
  //   - a completed direct purchase
  //   - a completed project purchase whose project bundles this file
  //   - an open cart item targeting one of this file's assets
  //   - an active print order (cart_created → shipped) — single-item
  //     OR multi-item — referencing this file
  // The dialog copy switches accordingly so users aren't surprised
  // when "Delete" silently archives instead.
  let ownerBuyerCount = 0;
  if (isOwner) {
    const fileAssetIds = assets.map((a) => a.id);

    // These only feed a `.length` sum used as a >0 test plus a
    // displayed integer — swap row-fetches for count() so Postgres
    // does the counting instead of shipping full row sets to Node.
    // ACTIVE_ORDER_STATUSES now imported from lib/print-statuses.ts
    // (the authoritative list, also used by
    // app/actions/files.ts:deleteFileListing, CON-164/MTR-231) instead
    // of the stale local duplicate that was missing "blocked" and the
    // agent-order statuses (BUG-A1).
    const [directBuyers, projectBuyers, cartUses, orderItemUses, orderUses] =
      await Promise.all([
        db
          .select({ value: count() })
          .from(purchases)
          .where(
            and(eq(purchases.fileId, file.id), eq(purchases.status, "completed"))
          ),
        db
          .select({ value: count() })
          .from(purchases)
          .innerJoin(projects, eq(purchases.projectId, projects.id))
          .innerJoin(projectFiles, eq(projectFiles.projectId, projects.id))
          .where(
            and(
              eq(projectFiles.fileId, file.id),
              eq(purchases.status, "completed")
            )
          ),
        fileAssetIds.length > 0
          ? db
              .select({ value: count() })
              .from(cartItems)
              .where(inArray(cartItems.fileAssetId, fileAssetIds))
          : Promise.resolve([{ value: 0 }]),
        fileAssetIds.length > 0
          ? db
              .select({ value: count() })
              .from(printOrderItems)
              .innerJoin(
                printOrders,
                eq(printOrderItems.printOrderId, printOrders.id)
              )
              .where(
                and(
                  inArray(printOrderItems.fileAssetId, fileAssetIds),
                  inArray(printOrders.status, [...ACTIVE_ORDER_STATUSES])
                )
              )
          : Promise.resolve([{ value: 0 }]),
        fileAssetIds.length > 0
          ? db
              .select({ value: count() })
              .from(printOrders)
              .where(
                and(
                  inArray(printOrders.fileAssetId, fileAssetIds),
                  inArray(printOrders.status, [...ACTIVE_ORDER_STATUSES])
                )
              )
          : Promise.resolve([{ value: 0 }]),
      ]);
    ownerBuyerCount =
      (directBuyers[0]?.value ?? 0) +
      (projectBuyers[0]?.value ?? 0) +
      (cartUses[0]?.value ?? 0) +
      (orderItemUses[0]?.value ?? 0) +
      (orderUses[0]?.value ?? 0);
  }
  // Activity stream — who has printed and who has downloaded this
  // file. Print activity unions legacy single-item printOrders rows
  // (`fileAssetId` set on the parent) with multi-item printOrderItems
  // children; only `PRINTED_STATUSES` count. Download activity is
  // sourced from `fileDownloads` (one row inserted per request by the
  // download route), grouped by user with the latest download time.
  // Anon downloads (userId IS NULL on free files) bump the running
  // counter on `files.downloadCount` but don't surface here.
  const fileAssetIds = assets.map((a) => a.id);
  const ACTIVITY_LIMIT = 50;

  // Each activity query is independently fallible — Neon HTTP can
  // cold-start with `fetch failed` connect timeouts, and any one of
  // these failing inside a top-level Promise.all would 500 the whole
  // page. The shared `swallow()` helper falls back to [] on failure so
  // the section just renders empty, rather than 500-ing the page.
  const [
    legacyPrintRows,
    itemPrintRows,
    downloadRows,
    commentRows,
  ] = await Promise.all([
    fileAssetIds.length === 0
      ? Promise.resolve(
          [] as Array<{
            id: string;
            createdAt: Date;
            material: string | null;
            vendorName: string | null;
            vendor: string | null;
            status: string;
            userId: string;
            username: string | null;
            displayName: string | null;
            avatarUrl: string | null;
          }>
        )
      : swallow(
          db
            .select({
              id: printOrders.id,
              createdAt: printOrders.createdAt,
              material: printOrders.material,
              vendorName: printOrders.vendorName,
              vendor: printOrders.vendor,
              status: printOrders.status,
              userId: users.id,
              username: users.username,
              displayName: users.displayName,
              avatarUrl: users.avatarUrl,
            })
            .from(printOrders)
            .innerJoin(users, eq(printOrders.userId, users.id))
            .where(
              and(
                inArray(printOrders.fileAssetId, fileAssetIds),
                inArray(printOrders.status, [...PRINTED_STATUSES])
              )
            )
            .orderBy(desc(printOrders.createdAt))
            .limit(ACTIVITY_LIMIT)
        ),
    fileAssetIds.length === 0
      ? Promise.resolve(
          [] as Array<{
            id: string;
            createdAt: Date;
            materialConfigId: string;
            vendorName: string | null;
            vendor: string | null;
            status: string;
            userId: string;
            username: string | null;
            displayName: string | null;
            avatarUrl: string | null;
          }>
        )
      : swallow(
          db
            .select({
              id: printOrderItems.id,
              createdAt: printOrderItems.createdAt,
              materialConfigId: printOrderItems.materialConfigId,
              vendorName: printOrderItems.vendorName,
              vendor: printOrderItems.vendorId,
              status: printOrders.status,
              userId: users.id,
              username: users.username,
              displayName: users.displayName,
              avatarUrl: users.avatarUrl,
            })
            .from(printOrderItems)
            .innerJoin(
              printOrders,
              eq(printOrderItems.printOrderId, printOrders.id)
            )
            .innerJoin(users, eq(printOrders.userId, users.id))
            .where(
              and(
                inArray(printOrderItems.fileAssetId, fileAssetIds),
                inArray(printOrders.status, [...PRINTED_STATUSES])
              )
            )
            .orderBy(desc(printOrderItems.createdAt))
            .limit(ACTIVITY_LIMIT)
        ),
    // One row per download event — the same user shows up once per
    // download. We could DISTINCT ON (user_id) here for a "unique
    // users" view, but the explicit ask is that the stream count
    // align with `files.downloadCount` (which counts every event).
    // Anon free-file downloads (userId IS NULL) are LEFT-joined
    // through; the renderer falls back to "Anonymous" for them.
    swallow(
      db
        .select({
          id: fileDownloads.id,
          userId: fileDownloads.userId,
          createdAt: fileDownloads.createdAt,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
        })
        .from(fileDownloads)
        .leftJoin(users, eq(fileDownloads.userId, users.id))
        .where(eq(fileDownloads.fileId, file.id))
        .orderBy(desc(fileDownloads.createdAt))
        .limit(ACTIVITY_LIMIT)
    ),
    // Comments — pull every comment for this file (top-level + replies)
    // in one query, ordered chronologically. The component splits
    // them into threads client-side via parentId. We don't filter
    // out soft-deleted rows here because the renderer needs them as
    // `[deleted]` placeholders to keep nested replies coherent.
    swallow(
      db
        .select({
          id: fileComments.id,
          parentId: fileComments.parentId,
          body: fileComments.body,
          deletedAt: fileComments.deletedAt,
          createdAt: fileComments.createdAt,
          updatedAt: fileComments.updatedAt,
          authorId: users.id,
          authorUsername: users.username,
          authorDisplayName: users.displayName,
          authorAvatarUrl: users.avatarUrl,
        })
        .from(fileComments)
        .innerJoin(users, eq(fileComments.userId, users.id))
        .where(eq(fileComments.fileId, file.id))
        .orderBy(asc(fileComments.createdAt))
        .limit(500)
    ),
  ]);

  const printRowsRaw = [
    ...legacyPrintRows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      materialConfigId: row.material,
      vendorName: row.vendorName ?? row.vendor,
      status: row.status,
      user: {
        id: row.userId,
        username: row.username,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
      },
    })),
    ...itemPrintRows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      materialConfigId: row.materialConfigId,
      vendorName: row.vendorName ?? row.vendor,
      status: row.status,
      user: {
        id: row.userId,
        username: row.username,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
      },
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, ACTIVITY_LIMIT);

  const materialLabels = await Promise.all(
    printRowsRaw.map((row) => buildMaterialLabel(row.materialConfigId))
  );

  const printActivity: PrintActivity[] = printRowsRaw.map((row, i) => ({
    id: row.id,
    user: row.user,
    materialLabel: materialLabels[i],
    vendorName: row.vendorName,
    status: row.status,
    createdAt: row.createdAt,
  }));

  const downloadActivity: DownloadActivity[] = downloadRows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    user: {
      id: row.userId,
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
    },
  }));

  // Blank deleted-comment bodies before serializing to the client.
  // The renderer ignores `body` when `deletedAt` is set anyway, but
  // not sending the original prose is one less audit risk.
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

  const recommendedMaterial = file.recommendedMaterialId
    ? getMaterialById(file.recommendedMaterialId)
    : null;

  // CraftCloud materials and finish groups for the edit dialog.
  // Owner-only — no need to load for visitors.
  let ccMaterials: Array<{ id: string; name: string; groupName: string }> = [];
  let ccFinishGroups: Record<string, Array<{ id: string; name: string }>> = {};
  if (isOwner) {
    const catalog = await getCraftCloudCatalog();
    ccMaterials = catalog.groups.flatMap((g) =>
      g.materials.map((m) => ({ id: m.id, name: m.name, groupName: g.name }))
    );
    ccFinishGroups = Object.fromEntries(
      catalog.groups.flatMap((g) =>
        g.materials.map((m) => [
          m.id,
          m.finishGroups.map((fg) => ({ id: fg.id, name: fg.name })),
        ])
      )
    );
  }

  // Curator photos carousel (kind='creator' only) — community photos
  // are now folded into the comments thread as photo-posts so a
  // listing's discussion reads as one stream.
  const feedPhotos: FeedPhoto[] = photosWithUrls.map((p) => ({
    id: p.id,
    downloadUrl: p.downloadUrl,
    caption: p.caption,
    createdAt: p.createdAt,
    kind: "creator" as const,
    author: null,
  }));

  // The live version (docs/file-versioning.md) drives the filename / size /
  // preview / bounding box, and the Print + Download buttons. `assets`
  // stays the whole history: order/print stats above count every version.
  const primaryAsset = pickCurrentAsset(file.currentAssetId, assets);
  const PREVIEWABLE = new Set(["stl", "obj", "3mf"]);
  const FINGERPRINTABLE = new Set(["stl", "obj", "3mf"]);
  const previewable =
    !!primaryAsset && PREVIEWABLE.has(primaryAsset.format);

  // Owner-only "Verifying upload..." pill while the deferred fingerprint
  // pass hasn't filled in geometry_hash yet. Only show for parseable
  // formats — 3mf/step/amf intentionally leave geometry_hash null and
  // would render the pill forever otherwise.
  const verifying =
    isOwner &&
    !file.flaggedReason &&
    !!primaryAsset &&
    FINGERPRINTABLE.has(primaryAsset.format) &&
    !primaryAsset.geometryHash;
  const rawDims = primaryAsset?.geometryData?.dimensions;
  const dims =
    rawDims &&
    typeof rawDims.x === "number" &&
    typeof rawDims.y === "number" &&
    typeof rawDims.z === "number"
      ? rawDims
      : null;

  const needsThumbnail =
    isOwner &&
    !file.thumbnailUrl &&
    !!primaryAsset &&
    previewable;

  // JSON-LD — only emitted for the public, indexable form of the
  // listing. Hiding it for drafts / archived listings keeps Google
  // from building a knowledge graph entry that vanishes when the
  // owner publishes / unpublishes.
  const jsonLd =
    file.status === "published"
      ? fileJsonLd({
          slug: file.slug,
          name: file.name,
          description: file.description,
          thumbnailUrl: file.thumbnailUrl,
          license: file.license,
          price: file.price,
          createdAt: file.createdAt,
          author: {
            username: file.username,
            displayName: file.displayName,
            avatarUrl: file.avatarUrl,
          },
        })
      : null;

  const licenseMeta = getLicenseMeta(file.license);
  const categoryLabel = file.category ? getCategoryLabel(file.category) : null;
  const creatorName = file.displayName || file.username;
  const paidAndLocked = file.price > 0 && !canDownload;

  // Social proof under the title. Counts come from the same rows the
  // Activity section lists, so the two can never disagree.
  const proof = [
    printActivity.length > 0 &&
      `${printActivity.length} ${printActivity.length === 1 ? "print" : "prints"}`,
    downloadActivity.length > 0 &&
      `${downloadActivity.length} ${downloadActivity.length === 1 ? "download" : "downloads"}`,
  ].filter(Boolean);

  const discussionEmpty = comments.length === 0 && buildsWithUrls.length === 0;
  // Owners don't see an empty Discussion invitation on their own
  // listing: there is nothing to invite themselves to.
  const showDiscussion = !(discussionEmpty && isOwner);

  return (
    <div className="mz-enter mx-auto w-full max-w-6xl px-4 pt-6 pb-16 sm:pt-10">
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdScript(jsonLd) }}
        />
      )}
      {needsThumbnail && primaryAsset && (
        <FileThumbnailGeneratorLazy
          fileId={file.id}
          fileAssetId={primaryAsset.id}
          format={primaryAsset.format}
          recommendedMaterialId={file.recommendedMaterialId}
        />
      )}
      {isOwner && file.flaggedReason && file.flaggedAt && (
        <ListingFlaggedBanner
          fileId={file.id}
          reason={file.flaggedReason}
          flaggedAt={file.flaggedAt}
        />
      )}
      <div className="flex flex-col gap-6">
        {isOwner && (
          <OwnerBar
            visibility={file.visibility === "public" ? "public" : "private"}
          >
            <EditFileButton
              fileId={file.id}
              initial={{
                name: file.name,
                description: file.description,
                tags: file.tags,
                category: file.category,
                price: file.price,
                license: file.license,
                visibility: file.visibility ?? "public",
                recommendedMaterialId: file.recommendedMaterialId,
                recommendedCcMaterialId: file.recommendedCcMaterialId,
                recommendedCcFinishGroupId: file.recommendedCcFinishGroupId,
                designTags: file.designTags,
                minWallThickness: file.minWallThickness,
                coverPhotoId: file.coverPhotoId,
              }}
              ccMaterials={ccMaterials}
              ccFinishGroups={ccFinishGroups}
              photos={photosWithUrls.map((p) => ({
                id: p.id,
                downloadUrl: p.downloadUrl,
              }))}
              hasBuyers={ownerBuyerCount > 0}
              trigger={
                <Button variant="outline" size="sm" aria-label="Edit file">
                  Edit
                </Button>
              }
            />
            <DeleteFileButton
              fileId={file.id}
              fileName={file.name}
              hasBuyers={ownerBuyerCount > 0}
              buyerCount={ownerBuyerCount}
              redirectTo="/"
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  aria-label="Delete file"
                >
                  Delete
                </Button>
              }
            />
          </OwnerBar>
        )}


        {/* Object left, decision right (DESIGN_SYSTEM § Space and layout).
            On phones the grid collapses to source order: preview, the
            title + actions, then the long-form content. From md the aside
            spans both rows and sticks, so Print stays in reach while the
            reader scrolls the description and discussion. */}
        <div className="grid grid-cols-1 gap-x-8 gap-y-8 md:grid-cols-[minmax(0,1fr)_19rem] md:grid-rows-[auto_1fr] lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-10">
          <div className="md:col-start-1 md:row-start-1">
            {previewable && primaryAsset ? (
              <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-muted/60">
                <FilePreview
                  fileId={file.id}
                  fileAssetId={primaryAsset.id}
                  format={primaryAsset.format}
                  materialColor={recommendedMaterial?.color ?? "#a1a1aa"}
                  recommendedMaterialId={file.recommendedMaterialId}
                  // Owner-only affordance. `POST /api/thumbnails`
                  // re-checks ownership regardless, so this governs
                  // what is offered, not what is permitted.
                  canUpdatePreview={isOwner}
                  // Everyone opens on the angle the author chose, not
                  // just the author. Null for files still on the
                  // automatic head-on capture.
                  initialView={previewView}
                />
              </div>
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-muted">
                <span className="text-[13px] text-subtle-foreground">
                  {primaryAsset
                    ? `Preview not supported for .${primaryAsset.format}`
                    : "No preview"}
                </span>
              </div>
            )}
          </div>

          <aside className="flex flex-col gap-6 md:sticky md:top-8 nav:top-24 md:col-start-2 md:row-span-2 md:row-start-1 md:self-start">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl leading-7 font-semibold text-balance">
                  {file.name}
                </h1>
                {verifying && <VerifyingPill />}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <Link
                  href={`/${file.username}`}
                  className="-my-1 -ml-1 flex w-fit items-center gap-2 rounded-full py-1 pr-2 pl-1 text-foreground transition-colors hover:bg-muted"
                >
                  <UserAvatar
                    seed={file.username || file.userId}
                    imageUrl={file.avatarUrl}
                    displayName={creatorName}
                    className="size-6 text-[11px]"
                  />
                  <span className="font-medium">{creatorName}</span>
                </Link>
                {proof.length > 0 && (
                  <span className="text-[13px] tabular-nums">
                    {proof.join(" · ")}
                  </span>
                )}
              </div>
              {parentProject && (
                <p className="text-[13px] leading-[18px] text-muted-foreground">
                  Part of{" "}
                  <Link
                    href={`/projects/${parentProject.slug}`}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {parentProject.name}
                  </Link>
                </p>
              )}
            </div>

            {file.price > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-2xl leading-7 font-semibold tabular-nums">
                  ${(file.price / 100).toFixed(2)}
                </p>
                <p className="text-[13px] leading-[18px] text-muted-foreground">
                  {canDownload
                    ? isOwner
                      ? "Your listing. Buyers download after paying."
                      : "You own this file."
                    : "One-time purchase. Download any time after."}
                </p>
                {isOwner && !file.ownerOnboarded && (
                  <div className="mt-2">
                    <PayoutSetupWarning />
                  </div>
                )}
              </div>
            )}

            {/* One primary per view. A paid file you don't own yet is
                for buying; everything else is for printing, which is
                why Print outranks Download (download is free and needs
                no help being found). Natural width, secondary first. */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start gap-2">
                {canDownload && (
                  <Button
                    variant="secondary"
                    size="lg"
                    render={<a href={`/files/${slug}/download`} />}
                  >
                    <Download size={16} />
                    Download
                  </Button>
                )}
                {primaryAsset && (
                  <Button
                    variant={paidAndLocked ? "secondary" : "default"}
                    size="lg"
                    render={<Link href={`/print/${primaryAsset.id}`} />}
                  >
                    <Print size={16} />
                    Get it printed
                  </Button>
                )}
                {paidAndLocked && (
                  <PurchaseButton
                    fileId={file.id}
                    priceCents={file.price}
                    label="Buy file"
                    size="lg"
                  />
                )}
              </div>
              {/* Editable STEP source (MTR-196) — renders only when this asset
                  actually has a persisted STEP (self-hiding for mesh-only /
                  non-CAD files, so no dead button). Same entitlement as the
                  STL download, enforced server-side in the action. */}
              {canDownload && primaryAsset && (
                <StepDownloadLink
                  fileAssetId={primaryAsset.id}
                  size="sm"
                  label="Download STEP (editable CAD)"
                  className="w-fit"
                />
              )}
              {primaryAsset && (
                <p className="text-[13px] leading-[18px] text-muted-foreground">
                  Instant quotes from print shops. Pick a material and we
                  ship it to you.
                </p>
              )}
            </div>

            <DetailList>
              {primaryAsset && (
                <DetailRow label="File">
                  <span className="truncate" title={primaryAsset.originalFilename}>
                    {primaryAsset.originalFilename}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatBytes(primaryAsset.fileSize)}
                  </span>
                </DetailRow>
              )}
              {dims && (
                <DetailRow label="Size">
                  <span className="tabular-nums">
                    {formatMm(dims.x)} × {formatMm(dims.y)} × {formatMm(dims.z)} mm
                  </span>
                </DetailRow>
              )}
              {recommendedMaterial && (
                <DetailRow label="Material">
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-full ring-1 ring-border"
                    style={{ backgroundColor: recommendedMaterial.color }}
                  />
                  <span className="truncate">{recommendedMaterial.name}</span>
                </DetailRow>
              )}
              {file.minWallThickness ? (
                <DetailRow label="Min wall">
                  <span className="tabular-nums">
                    {(file.minWallThickness / 10).toFixed(1)} mm
                  </span>
                </DetailRow>
              ) : null}
              {categoryLabel && (
                <DetailRow label="Category">
                  <Link
                    href={`/files?category=${file.category}`}
                    className="truncate underline-offset-4 hover:underline"
                  >
                    {categoryLabel}
                  </Link>
                </DetailRow>
              )}
              {licenseMeta && (
                <DetailRow label="License">
                  <a
                    href={licenseMeta.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={licenseMeta.summary}
                    className="truncate underline-offset-4 hover:underline"
                  >
                    {licenseMeta.shortName}
                    <span className="text-muted-foreground"> · {licenseMeta.name}</span>
                  </a>
                </DetailRow>
              )}
            </DetailList>
          </aside>

          <div className="flex min-w-0 flex-col gap-10 md:col-start-1 md:row-start-2">
            {file.description && (
              <section className="flex flex-col gap-2">
                <h2 className="text-base leading-6 font-semibold">About</h2>
                <ExpandableDescription source={file.description} />
              </section>
            )}

            {(feedPhotos.length > 0 || isOwner) && (
              <section className="flex flex-col gap-3">
                <h2 className="text-base leading-6 font-semibold">Photos</h2>
                <PhotosFeed
                  photos={feedPhotos}
                  targetType="file"
                  targetId={file.id}
                  ownerId={file.userId}
                  viewerId={userId}
                  uploadAs={isOwner ? "creator" : null}
                />
              </section>
            )}

            {showDiscussion && (
              <section className="flex flex-col gap-4">
                <h2 className="flex items-baseline gap-2 text-base leading-6 font-semibold">
                  Discussion
                  {!discussionEmpty && (
                    <span className="text-sm font-normal text-subtle-foreground tabular-nums">
                      {comments.length + buildsWithUrls.length}
                    </span>
                  )}
                </h2>
                <CommentsSection
                  target="file"
                  targetId={file.id}
                  comments={comments}
                  photoPosts={buildsWithUrls}
                  ownerId={file.userId}
                  viewerId={userId}
                  isSignedIn={!!userId}
                  signInRedirect={`/files/${slug}`}
                  acceptPhoto={canPostBuild}
                />
              </section>
            )}

            <FileActivity
              prints={printActivity}
              downloads={downloadActivity}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
