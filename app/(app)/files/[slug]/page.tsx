import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files, fileAssets, users, purchases, filePhotos } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PhotoGallery } from "@/components/photos/photo-gallery";
import { PhotoUploader } from "@/components/photos/photo-uploader";
import { getMaterialById } from "@/lib/materials";
import { generateDownloadUrl } from "@/lib/storage";

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

  const [file] = await db
    .select({
      id: files.id,
      name: files.name,
      description: files.description,
      slug: files.slug,
      price: files.price,
      license: files.license,
      tags: files.tags,
      designTags: files.designTags,
      recommendedMaterialId: files.recommendedMaterialId,
      minWallThickness: files.minWallThickness,
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
    .where(and(eq(files.slug, slug), eq(files.status, "published")));

  if (!file) notFound();

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

  const { userId } = await auth();
  const isOwner = userId === file.userId;

  let hasPurchased = false;
  if (userId && !isOwner && file.price > 0) {
    const [purchase] = await db
      .select()
      .from(purchases)
      .where(
        and(
          eq(purchases.buyerId, userId),
          eq(purchases.fileId, file.id),
          eq(purchases.status, "completed")
        )
      );
    hasPurchased = !!purchase;
  }

  const canDownload = isOwner || file.price === 0 || hasPurchased;
  const recommendedMaterial = file.recommendedMaterialId
    ? getMaterialById(file.recommendedMaterialId)
    : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* 3D Viewer placeholder */}
          <div className="aspect-[4/3] rounded-lg bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
            <span className="text-muted-foreground/40">3D Preview</span>
          </div>

          {/* Part photos */}
          {(photosWithUrls.length > 0 || isOwner) && (
            <div>
              <PhotoGallery photos={photosWithUrls} isOwner={isOwner} />
              {isOwner && <PhotoUploader fileId={file.id} />}
            </div>
          )}

          {/* File info */}
          <div>
            <h1 className="text-2xl font-bold">{file.name}</h1>
            {file.description && (
              <p className="mt-2 text-muted-foreground">{file.description}</p>
            )}

            {/* Tags */}
            {file.tags && file.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {file.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {/* Material recommendation */}
            {(recommendedMaterial || (file.designTags && file.designTags.length > 0)) && (
              <Card className="mt-4">
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
                        <Badge key={tag} variant="outline" className="text-[10px]">
                          {DESIGN_TAG_LABELS[tag] || tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {file.minWallThickness && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Min. wall thickness: {(file.minWallThickness / 10).toFixed(1)}mm
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* File assets */}
          <div>
            <h2 className="font-semibold">Files</h2>
            <div className="mt-2 space-y-2">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {asset.originalFilename}
                    </span>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {asset.format}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {(asset.fileSize / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {canDownload && (
                      <Button variant="ghost" size="xs" render={
                        <a href={`/files/${slug}/download?asset=${asset.id}`} />
                      }>
                        Download
                      </Button>
                    )}
                    <Button variant="ghost" size="xs" render={
                      <Link href={`/print/${asset.id}`} />
                    }>
                      Print
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
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
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
