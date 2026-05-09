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
import { eq, and, asc, desc, inArray, isNull } from "drizzle-orm";
import { ownsLoadedFile, userHasUsedFile } from "@/lib/entitlement";
import { Card, CardContent } from "@/components/ui/card";
import { ExpandableDescription } from "@/components/ui/expandable-description";
import { Button } from "@/components/ui/button";
import {
  PhotosFeed,
  type FeedPhoto,
} from "@/components/photos/photos-feed";
import { DeleteFileButton } from "@/components/files/delete-file-button";
import { EditFileButton } from "@/components/files/edit-file-button";
import { FileThumbnailGenerator } from "@/components/files/file-thumbnail-generator";
import { OrderModelPreview } from "@/components/print/order-model-preview";
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
import { Pencil } from "@/components/icons/pencil";
import { Trash } from "@/components/icons/trash";
import { getLicenseMeta } from "@/lib/licenses";
import { getMaterialById } from "@/lib/materials";
import { findMaterialConfig } from "@/lib/craftcloud/catalog";
import { generateDownloadUrl } from "@/lib/storage";
import { PRINTED_STATUSES } from "@/lib/print-statuses";
import { swallow } from "@/lib/utils/swallow";

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
  const [row] = await db
    .select({
      name: files.name,
      description: files.description,
      thumbnailUrl: files.thumbnailUrl,
      status: files.status,
      displayName: users.displayName,
      username: users.username,
    })
    .from(files)
    .innerJoin(users, eq(files.userId, users.id))
    .where(eq(files.slug, slug));

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

  // Look up by slug only — we filter by published status (or owner) below.
  const [file] = await db
    .select({
      id: files.id,
      status: files.status,
      name: files.name,
      description: files.description,
      slug: files.slug,
      price: files.price,
      license: files.license,
      tags: files.tags,
      designTags: files.designTags,
      recommendedMaterialId: files.recommendedMaterialId,
      minWallThickness: files.minWallThickness,
      visibility: files.visibility,
      thumbnailUrl: files.thumbnailUrl,
      coverPhotoId: files.coverPhotoId,
      downloadCount: files.downloadCount,
      viewCount: files.viewCount,
      createdAt: files.createdAt,
      flaggedReason: files.flaggedReason,
      flaggedAt: files.flaggedAt,
      userId: files.userId,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(files)
    .innerJoin(users, eq(files.userId, users.id))
    .where(eq(files.slug, slug));

  // Visible to anyone if published; visible to owner regardless of status.
  if (!file) notFound();
  const viewerIsOwner = userId === file.userId;
  if (file.status !== "published" && !viewerIsOwner) notFound();

  const assets = await db
    .select()
    .from(fileAssets)
    .where(eq(fileAssets.fileId, file.id));

  // Curator gallery photos — `kind = 'creator'`. Mapped into the
  // unified PhotosFeed shape below alongside community photos.
  const photos = await db
    .select()
    .from(filePhotos)
    .where(and(eq(filePhotos.fileId, file.id), eq(filePhotos.kind, "creator")))
    .orderBy(asc(filePhotos.sortOrder));

  // Generate download URLs for photos
  const photosWithUrls = await Promise.all(
    photos.map(async (photo) => ({
      id: photo.id,
      caption: photo.caption,
      createdAt: photo.createdAt,
      downloadUrl: await generateDownloadUrl(photo.storageKey, 3600),
    }))
  );

  // Community makes — joined to users for poster identity. R2 URLs
  // are signed at request time same as curator photos. Limit to 60 so
  // a popular file doesn't push 500 makes through the page.
  const makeRows = await db
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
      and(eq(filePhotos.fileId, file.id), eq(filePhotos.kind, "make"))
    )
    .orderBy(desc(filePhotos.createdAt))
    .limit(60);
  const makesWithUrls = await Promise.all(
    makeRows.map(async (row) => ({
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
  );

  const isOwner = viewerIsOwner;
  // Gates the "Share your make" affordance. Owners can also share —
  // they're a user too — but we still call the helper to be uniform.
  // The helper returns false for anon viewers without a roundtrip.
  const canPostMake = await userHasUsedFile(userId, file.id);
  const canDownload = await ownsLoadedFile(userId, {
    id: file.id,
    price: file.price,
    userId: file.userId,
  });

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
    const ACTIVE_ORDER_STATUSES = [
      "cart_created",
      "ordered",
      "in_production",
      "shipped",
    ] as const;

    const [directBuyers, projectBuyers, cartUses, orderItemUses, orderUses] =
      await Promise.all([
        db
          .select({ id: purchases.id })
          .from(purchases)
          .where(
            and(eq(purchases.fileId, file.id), eq(purchases.status, "completed"))
          ),
        db
          .select({ id: purchases.id })
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
              .select({ id: cartItems.id })
              .from(cartItems)
              .where(inArray(cartItems.fileAssetId, fileAssetIds))
          : Promise.resolve([]),
        fileAssetIds.length > 0
          ? db
              .select({ id: printOrderItems.id })
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
          : Promise.resolve([]),
        fileAssetIds.length > 0
          ? db
              .select({ id: printOrders.id })
              .from(printOrders)
              .where(
                and(
                  inArray(printOrders.fileAssetId, fileAssetIds),
                  inArray(printOrders.status, [...ACTIVE_ORDER_STATUSES])
                )
              )
          : Promise.resolve([]),
      ]);
    ownerBuyerCount =
      directBuyers.length +
      projectBuyers.length +
      cartUses.length +
      orderItemUses.length +
      orderUses.length;
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

  // Primary asset drives the filename / size / preview / bounding box.
  const primaryAsset = assets[0] ?? null;
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {needsThumbnail && primaryAsset && (
        <FileThumbnailGenerator
          fileId={file.id}
          fileAssetId={primaryAsset.id}
          format={primaryAsset.format}
        />
      )}
      {isOwner && file.flaggedReason && file.flaggedAt && (
        <ListingFlaggedBanner
          reason={file.flaggedReason}
          flaggedAt={file.flaggedAt}
        />
      )}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-3 lg:items-start lg:gap-8">
        {/* Title + filename · filesize · bounding-box. The format
            badge that used to live here was duplicative — the
            original filename already carries the extension. */}
        <div className="order-1 space-y-1 lg:col-span-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{file.name}</h1>
            {verifying && <VerifyingPill />}
          </div>
          {primaryAsset && (
            <p className="text-sm text-muted-foreground">
              {primaryAsset.originalFilename}
              <span className="mx-1.5">·</span>
              {formatBytes(primaryAsset.fileSize)}
            </p>
          )}
          {dims && (
            <p className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Bounding box</span>
              <span className="font-mono">
                {dims.x.toFixed(1)} × {dims.y.toFixed(1)} × {dims.z.toFixed(1)} mm
              </span>
            </p>
          )}
        </div>

        {/* 3D preview — order-2 on mobile so it sits right under the
            title block, with the action card slotting in below it
            (order-3) before the buyer scrolls into the long
            description / discussion. On desktop pinned to row 2
            cols 1-2 via explicit placement, so it doesn't fight
            with the row-spanning action card. */}
        <div className="order-2 lg:col-span-2 lg:col-start-1 lg:row-start-2">
          {previewable && primaryAsset ? (
            <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/10">
              <OrderModelPreview
                fileAssetId={primaryAsset.id}
                format={primaryAsset.format}
                materialColor={recommendedMaterial?.color ?? "#a1a1aa"}
              />
            </div>
          ) : (
            <div className="aspect-[4/3] rounded-2xl bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
              <span className="text-xs text-muted-foreground/50">
                {primaryAsset
                  ? `Preview not supported for .${primaryAsset.format}`
                  : "No preview"}
              </span>
            </div>
          )}
        </div>

        {/* Main content (description, photos, comments, activity) —
            order-4 on mobile, lg row 3 cols 1-2 on desktop. */}
        <div className="order-4 space-y-6 lg:col-span-2 lg:col-start-1 lg:row-start-3">
          {/* Description — markdown-rendered, with inline expand for
              long-form copy. Short descriptions render in full; long
              ones collapse to a few lines with a gradient fade and
              "Show more" toggle. */}
          {file.description && (
            <ExpandableDescription source={file.description} />
          )}

          {/* Print recommendations — compact inline metadata so a
              listing with only a recommended material doesn't get a
              giant card. Search tags + design tags intentionally
              don't render publicly; they're indexing/filtering
              metadata, not creator-facing copy. */}
          {(recommendedMaterial || file.minWallThickness) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              {recommendedMaterial && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-muted-foreground/80">Recommended:</span>
                  <span
                    className="h-3 w-3 rounded-sm border border-border"
                    style={{ backgroundColor: recommendedMaterial.color }}
                  />
                  <span className="font-medium text-foreground">
                    {recommendedMaterial.name}
                  </span>
                  <span className="text-muted-foreground/80">
                    · {recommendedMaterial.method}
                  </span>
                </span>
              )}
              {file.minWallThickness && (
                <span>
                  {recommendedMaterial && (
                    <span className="mr-3 text-muted-foreground/40">·</span>
                  )}
                  Min wall {(file.minWallThickness / 10).toFixed(1)}mm
                </span>
              )}
            </div>
          )}

          {/* Curator carousel — owner-only authoritative photos.
              Sits between the description and the Discussion card so
              the creator's reference shots are clearly attributed to
              them, separate from the community discussion below.
              Hidden for non-owners with no curator photos. */}
          {(feedPhotos.length > 0 || isOwner) && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold">Photos</h2>
              <PhotosFeed
                photos={feedPhotos}
                fileId={file.id}
                ownerId={file.userId}
                viewerId={userId}
                uploadAs={isOwner ? "creator" : null}
              />
            </div>
          )}

          {/* Discussion — text comments interleaved with community
              photos (commenter posts). Composer accepts an optional
              photo attachment so a "post" can be text, a photo, or
              both. */}
          <Card>
            <CardContent className="space-y-5">
              <h2 className="text-base font-semibold">Discussion</h2>
              <CommentsSection
                target="file"
                targetId={file.id}
                comments={comments}
                photoPosts={makesWithUrls}
                ownerId={file.userId}
                viewerId={userId}
                isSignedIn={!!userId}
                signInRedirect={`/files/${slug}`}
                acceptPhoto={canPostMake}
                fileId={file.id}
              />
            </CardContent>
          </Card>

          {/* Activity stream — prints + downloads. The component
              self-hides when both are empty. */}
          <FileActivity
            prints={printActivity}
            downloads={downloadActivity}
          />
        </div>

        {/* Action card — order-3 on mobile so price + Print + Download
            sit right under the 3D preview (the buyer's focal point)
            before the long description / discussion scroll. On desktop
            pinned to col 3 spanning all three rows with sticky
            positioning so it stays in view while the user scrolls. */}
        <div className="order-3 space-y-4 lg:col-start-3 lg:row-start-1 lg:row-span-3 lg:sticky lg:top-6">
          {/* Compact action card. Top row pairs the creator identity
              (left) with owner-only edit/delete icons (right) in a
              flex row — keeps the icons aligned to the top edge of
              the card without absolute positioning. Print is the
              primary CTA (the project's revenue path); Download is
              demoted to secondary. License is a tiny line below the
              price; the running download count moved to the activity
              tab so it's no longer duplicated here. */}
          <Card>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-2">
                <Link
                  href={`/u/${file.username}`}
                  className="flex flex-1 min-w-0 items-center gap-2.5 hover:opacity-80 transition-opacity"
                >
                  <UserAvatar
                    seed={file.username || file.userId}
                    imageUrl={file.avatarUrl}
                    displayName={file.displayName || file.username}
                    className="h-10 w-10"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-tight truncate">
                      {file.displayName || file.username}
                    </div>
                    {file.username && (
                      <div className="text-xs text-muted-foreground truncate">
                        @{file.username}
                      </div>
                    )}
                  </div>
                </Link>

                {isOwner && (
                  <div className="flex shrink-0 gap-1">
                    <EditFileButton
                      fileId={file.id}
                      initial={{
                        name: file.name,
                        description: file.description,
                        tags: file.tags,
                        price: file.price,
                        license: file.license,
                        visibility: file.visibility ?? "public",
                        recommendedMaterialId: file.recommendedMaterialId,
                        designTags: file.designTags,
                        minWallThickness: file.minWallThickness,
                        coverPhotoId: file.coverPhotoId,
                      }}
                      photos={photosWithUrls.map((p) => ({
                        id: p.id,
                        downloadUrl: p.downloadUrl,
                      }))}
                      hasBuyers={ownerBuyerCount > 0}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon-lg"
                          className="rounded-[12px] p-2"
                          aria-label="Edit file"
                        >
                          <Pencil className="size-5" />
                        </Button>
                      }
                    />
                    <DeleteFileButton
                      fileId={file.id}
                      fileName={file.name}
                      hasBuyers={ownerBuyerCount > 0}
                      buyerCount={ownerBuyerCount}
                      redirectTo={`/u/${file.username}`}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon-lg"
                          className="rounded-[12px] p-2 text-destructive hover:text-destructive"
                          aria-label="Delete file"
                        >
                          <Trash className="size-5" />
                        </Button>
                      }
                    />
                  </div>
                )}
              </div>

              <div>
                {file.price > 0 ? (
                  <div className="text-2xl font-bold leading-none">
                    ${(file.price / 100).toFixed(2)}
                  </div>
                ) : (
                  <div className="text-base font-semibold leading-tight">
                    Free to use
                  </div>
                )}
                {(() => {
                  const meta = getLicenseMeta(file.license);
                  if (!meta) return null;
                  return (
                    <a
                      href={meta.url}
                      target="_blank"
                      rel="noreferrer"
                      title={meta.summary}
                      className="mt-1 inline-block text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {meta.shortName} · {meta.name}
                    </a>
                  );
                })()}
              </div>

              <div className="space-y-2">
                {assets[0] && (
                  <Button
                    className="w-full"
                    render={<Link href={`/print/${assets[0].id}`} />}
                  >
                    Print this file
                  </Button>
                )}
                {canDownload ? (
                  <Button
                    variant="secondary"
                    className="w-full"
                    render={<a href={`/files/${slug}/download`} />}
                  >
                    Download
                  </Button>
                ) : file.price > 0 ? (
                  <Button variant="secondary" className="w-full">
                    Purchase
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
