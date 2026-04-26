import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  files,
  fileAssets,
  users,
  purchases,
  filePhotos,
  projects,
  projectFiles,
} from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { userOwnsFile } from "@/lib/entitlement";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PhotoGallery } from "@/components/photos/photo-gallery";
import { PhotoUploader } from "@/components/photos/photo-uploader";
import { DeleteFileButton } from "@/components/files/delete-file-button";
import { EditFileButton } from "@/components/files/edit-file-button";
import { FileThumbnailGenerator } from "@/components/files/file-thumbnail-generator";
import { OrderModelPreview } from "@/components/print/order-model-preview";
import { getMaterialById } from "@/lib/materials";
import { generateDownloadUrl } from "@/lib/storage";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

const DESIGN_TAG_LABELS: Record<string, string> = {
  strong: "Strong",
  flexible: "Flexible",
  "heat-resistant": "Heat Resistant",
  watertight: "Watertight",
  detailed: "Detailed",
  lightweight: "Lightweight",
};

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
      downloadCount: files.downloadCount,
      viewCount: files.viewCount,
      createdAt: files.createdAt,
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

  // Get part photos
  const photos = await db
    .select()
    .from(filePhotos)
    .where(eq(filePhotos.fileId, file.id))
    .orderBy(asc(filePhotos.sortOrder));

  // Generate download URLs for photos
  const photosWithUrls = await Promise.all(
    photos.map(async (photo) => ({
      id: photo.id,
      storageKey: photo.storageKey,
      caption: photo.caption,
      downloadUrl: await generateDownloadUrl(photo.storageKey, 3600),
    }))
  );

  const isOwner = viewerIsOwner;
  const canDownload = await userOwnsFile(userId, file.id);

  // Owner needs the buyer count to know whether deleting will hard-
  // delete or soft-archive — gate the query on isOwner so we don't pay
  // for it on every public view. Counts both direct file purchases and
  // project purchases that include this file.
  let ownerBuyerCount = 0;
  if (isOwner) {
    const directBuyers = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(
        and(eq(purchases.fileId, file.id), eq(purchases.status, "completed"))
      );
    const projectBuyers = await db
      .select({ id: purchases.id })
      .from(purchases)
      .innerJoin(projects, eq(purchases.projectId, projects.id))
      .innerJoin(projectFiles, eq(projectFiles.projectId, projects.id))
      .where(
        and(
          eq(projectFiles.fileId, file.id),
          eq(purchases.status, "completed")
        )
      );
    ownerBuyerCount = directBuyers.length + projectBuyers.length;
  }
  const recommendedMaterial = file.recommendedMaterialId
    ? getMaterialById(file.recommendedMaterialId)
    : null;

  // Primary asset drives the filename / size / preview / bounding box.
  const primaryAsset = assets[0] ?? null;
  const PREVIEWABLE = new Set(["stl", "obj", "3mf"]);
  const previewable =
    !!primaryAsset && PREVIEWABLE.has(primaryAsset.format);
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
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Title + filename · size */}
          <div>
            <h1 className="text-2xl font-bold">{file.name}</h1>
            {primaryAsset && (
              <p className="mt-1 text-sm text-muted-foreground">
                {primaryAsset.originalFilename}
                <span className="mx-1.5">·</span>
                {formatBytes(primaryAsset.fileSize)}
                <span className="mx-1.5">·</span>
                <span className="uppercase">{primaryAsset.format}</span>
              </p>
            )}
          </div>

          {/* 3D preview */}
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

          {/* Bounding box */}
          {dims && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Bounding box</span>
              <span className="font-mono">
                {dims.x.toFixed(1)} × {dims.y.toFixed(1)} × {dims.z.toFixed(1)} mm
              </span>
            </div>
          )}

          {/* Description */}
          {file.description && (
            <p className="text-muted-foreground leading-relaxed">
              {file.description}
            </p>
          )}

          {/* Tags */}
          {file.tags && file.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {file.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {/* Print recommendations */}
          {(recommendedMaterial ||
            (file.designTags && file.designTags.length > 0)) && (
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Print Recommendations from Creator
                </p>
                {recommendedMaterial && (
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="h-6 w-6 rounded border border-border shrink-0"
                      style={{ backgroundColor: recommendedMaterial.color }}
                    />
                    <span className="text-sm font-medium">
                      {recommendedMaterial.name}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {recommendedMaterial.method}
                    </Badge>
                  </div>
                )}
                {file.designTags && file.designTags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {file.designTags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="text-[10px]"
                      >
                        {DESIGN_TAG_LABELS[tag] || tag}
                      </Badge>
                    ))}
                  </div>
                )}
                {file.minWallThickness && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Min. wall thickness:{" "}
                    {(file.minWallThickness / 10).toFixed(1)}mm
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Part photos */}
          {(photosWithUrls.length > 0 || isOwner) && (
            <div>
              <PhotoGallery photos={photosWithUrls} isOwner={isOwner} />
              {isOwner && <PhotoUploader fileId={file.id} />}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Creator card */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                {file.avatarUrl && (
                  <img
                    src={file.avatarUrl}
                    alt=""
                    className="h-10 w-10 rounded-full"
                  />
                )}
                <div>
                  <Link
                    href={`/u/${file.username}`}
                    className="font-medium text-sm hover:underline"
                  >
                    {file.displayName || file.username}
                  </Link>
                </div>
              </div>

              <Separator className="my-4" />

              {/* Price + actions */}
              {file.price > 0 ? (
                <>
                  <p className="text-2xl font-bold">
                    ${(file.price / 100).toFixed(2)}
                  </p>
                  {canDownload ? (
                    <Button className="w-full mt-3" render={
                      <a href={`/files/${slug}/download`} />
                    }>
                      Download
                    </Button>
                  ) : (
                    <Button className="w-full mt-3">
                      Purchase
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <p className="text-lg font-medium text-muted-foreground">
                    Free
                  </p>
                  <Button className="w-full mt-3" render={
                    <a href={`/files/${slug}/download`} />
                  }>
                    Download
                  </Button>
                </>
              )}

              {assets[0] && (
                <Button variant="outline" className="w-full mt-2" render={
                  <Link href={`/print/${assets[0].id}`} />
                }>
                  Print this file
                </Button>
              )}

              <Separator className="my-4" />

              <div className="text-sm text-muted-foreground space-y-1">
                <p className="capitalize">License: {file.license}</p>
                <p>{file.downloadCount} downloads</p>
              </div>

              {isOwner && (
                <>
                  <Separator className="my-4" />
                  <div className="space-y-2">
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
                      }}
                      hasBuyers={ownerBuyerCount > 0}
                    />
                    <DeleteFileButton
                      fileId={file.id}
                      fileName={file.name}
                      hasBuyers={ownerBuyerCount > 0}
                      buyerCount={ownerBuyerCount}
                      redirectTo={`/u/${file.username}`}
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
