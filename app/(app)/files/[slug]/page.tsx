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
import { ownsLoadedFile, userHasUsedFile } from "@/lib/entitlement";
import { isOrgMember } from "@/lib/authorization";
import { Card, CardContent } from "@/components/ui/card";
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
import { LicenseBadge } from "@/components/licenses/license-badge";
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

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
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
      <div className="flex flex-col gap-8">
        {/* Admin-only bar — visibility status + owner controls, above
            all page content. */}
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
              redirectTo={`/${file.username}`}
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

        {/* Hero — 3D preview left, file info right on md+ */}
        <div className="flex flex-col gap-6 md:grid md:grid-cols-[3fr_2fr] md:items-start md:gap-8">
          {/* 3D preview */}
          <div>
            {previewable && primaryAsset ? (
              <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/10">
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
              <div className="aspect-[4/3] rounded-2xl bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                <span className="text-xs text-muted-foreground/50">
                  {primaryAsset
                    ? `Preview not supported for .${primaryAsset.format}`
                    : "No preview"}
                </span>
              </div>
            )}
          </div>

          {/* File info + actions */}
          <div className="flex flex-col gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{file.name}</h1>
                {verifying && <VerifyingPill />}
              </div>
              <div className="mt-2 space-y-1">
                <Link
                  href={`/${file.username}`}
                  className="flex w-fit items-center gap-1.5 hover:underline"
                >
                  <UserAvatar
                    seed={file.username || file.userId}
                    imageUrl={file.avatarUrl}
                    displayName={file.displayName || file.username}
                    className="h-5 w-5"
                  />
                  <span className="text-sm text-muted-foreground">
                    {file.displayName || file.username}
                  </span>
                </Link>
                {parentProject && (
                  <Link
                    href={`/projects/${parentProject.slug}`}
                    className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline"
                  >
                    <span className="text-muted-foreground/60">Part of</span>
                    <span>{parentProject.name}</span>
                  </Link>
                )}
              </div>
              {primaryAsset && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {primaryAsset.originalFilename}
                  <span className="mx-1.5">·</span>
                  {formatBytes(primaryAsset.fileSize)}
                </p>
              )}
              {dims && (
                <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Bounding box</span>
                  <span className="font-mono">
                    {dims.x.toFixed(1)} × {dims.y.toFixed(1)} × {dims.z.toFixed(1)} mm
                  </span>
                </p>
              )}
              {file.category && getCategoryLabel(file.category) && (
                <div className="mt-3">
                  <Link
                    href={`/files?category=${file.category}`}
                    className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {getCategoryLabel(file.category)}
                  </Link>
                </div>
              )}
            </div>

            {file.price > 0 && (
              <>
                {isOwner && !file.ownerOnboarded && <PayoutSetupWarning />}
                {!canDownload && (
                  <PurchaseButton fileId={file.id} priceCents={file.price} />
                )}
              </>
            )}

            {/* Primary action row. Download + Print are what this page is
                for, so they get the tallest size in the system and a filled
                treatment on both — the outline/sm pair read as tertiary
                chrome next to the 3D preview. Print keeps `default` so it
                still wins the row; Download is `secondary` rather than
                `outline` so it has weight without competing. */}
            <div className="flex flex-col gap-2.5">
              <div className="flex gap-2.5">
                {canDownload && (
                  <Button
                    variant="secondary"
                    size="xl"
                    className="min-w-0 flex-1 font-semibold"
                    render={<a href={`/files/${slug}/download`} />}
                  >
                    <Download size={18} />
                    Download
                  </Button>
                )}
                {assets[0] && (
                  <Button
                    size="xl"
                    className="min-w-0 flex-1 font-semibold"
                    render={<Link href={`/print/${assets[0].id}`} />}
                  >
                    <Print size={18} />
                    Print
                  </Button>
                )}
              </div>
              {/* Editable STEP source (MTR-196) — renders only when this asset
                  actually has a persisted STEP (self-hiding for mesh-only /
                  non-CAD files, so no dead button). Same entitlement as the
                  STL download, enforced server-side in the action. */}
              {canDownload && assets[0] && (
                <StepDownloadLink
                  fileAssetId={assets[0].id}
                  className="w-full"
                />
              )}
            </div>
          </div>
        </div>

        {/* Content below the hero */}
        <div className="space-y-6">
          {file.description && (
            <ExpandableDescription source={file.description} />
          )}

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

          {(feedPhotos.length > 0 || isOwner) && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold">Photos</h2>
              <PhotosFeed
                photos={feedPhotos}
                targetType="file"
                targetId={file.id}
                ownerId={file.userId}
                viewerId={userId}
                uploadAs={isOwner ? "creator" : null}
              />
            </div>
          )}

          {comments.length === 0 && buildsWithUrls.length === 0 ? (
            // Empty discussion skips the muted Card — the green
            // invitation banner is the whole section.
            <section className="space-y-3">
              <h2 className="text-base font-semibold">Discussion</h2>
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
          ) : (
            <Card className="bg-muted/50">
              <CardContent className="space-y-5">
                <h2 className="text-base font-semibold">Discussion</h2>
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
              </CardContent>
            </Card>
          )}

          <FileActivity
            prints={printActivity}
            downloads={downloadActivity}
          />

          <div className="flex justify-center pt-2">
            <LicenseBadge license={file.license} />
          </div>
        </div>
      </div>
    </div>
  );
}
