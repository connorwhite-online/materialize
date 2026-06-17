import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { FileAssetPrintShell } from "@/components/print/file-asset-print-shell";
import { getMaterialById } from "@/lib/materials";
import { resolveRecommendedCraftCloudMaterialId } from "@/lib/materials/craftcloud-resolver";
import { getCheckoutModel } from "@/lib/env";
import { Badge } from "@/components/ui/badge";
import { DESIGN_TAG_LABELS } from "@/lib/validations/file";

export default async function PrintConfigPage(props: {
  params: Promise<{ fileAssetId: string }>;
  searchParams: Promise<{ material?: string; finish?: string; project?: string }>;
}) {
  const { fileAssetId } = await props.params;
  // CraftCloud material id threaded from /materials/[slug]'s
  // "Print with X" link. Forwarded to MaterialPicker's preselect
  // effect; exact-id match is reliable since it came from the
  // same catalog the quote route enriches against.
  //
  // `project` is the slug of the project print hub the user came
  // from (the "Print this project" flow). Forwarded so a successful
  // Add to Cart routes back into that hub instead of the personal
  // library, letting the user walk the project's files one by one.
  const { material: preselectMaterialId, finish: preselectFinishGroupId, project: projectSlug } =
    await props.searchParams;

  const { userId } = await auth();

  const [asset] = await db
    .select({
      id: fileAssets.id,
      originalFilename: fileAssets.originalFilename,
      format: fileAssets.format,
      fileSize: fileAssets.fileSize,
      geometryData: fileAssets.geometryData,
      storageKey: fileAssets.storageKey,
      craftCloudModelId: fileAssets.craftCloudModelId,
      fileName: files.name,
      fileUserId: files.userId,
      fileStatus: files.status,
      recommendedMaterialId: files.recommendedMaterialId,
      recommendedCcMaterialId: files.recommendedCcMaterialId,
      recommendedCcFinishGroupId: files.recommendedCcFinishGroupId,
      designTags: files.designTags,
      minWallThickness: files.minWallThickness,
    })
    .from(fileAssets)
    .leftJoin(files, eq(fileAssets.fileId, files.id))
    .where(eq(fileAssets.id, fileAssetId));

  if (!asset) notFound();

  // Owner-or-published only — mirrors the download-url / preview byte
  // routes. Without this, any visitor could load another user's private
  // model metadata and config UI by guessing the asset id.
  const isOwner = userId && asset.fileUserId === userId;
  const isPublished = asset.fileStatus === "published";
  if (!isOwner && !isPublished) notFound();

  const recommendedMaterial = asset.recommendedMaterialId
    ? getMaterialById(asset.recommendedMaterialId)
    : null;

  // If the creator stated an ideal material and the visitor didn't
  // arrive with an explicit `?material=` scope, pre-scope the picker to
  // that material so they land on (essentially) just vendor selection.
  // Resolver returns null on no confident match → full picker (no
  // regression). An explicit `?material=` always wins.
  // Resolve the preselect material: explicit ?material= wins, then a
  // directly-stored CraftCloud UUID (most reliable — no fuzzy lookup),
  // then fall back to the fuzzy editorial-slug resolver.
  const resolvedPreselectMaterialId =
    preselectMaterialId ??
    asset.recommendedCcMaterialId ??
    (await resolveRecommendedCraftCloudMaterialId(asset.recommendedMaterialId)) ??
    undefined;

  // Finish group preselect: explicit ?finish= wins, then the DB value.
  // Only used when a material preselect is also resolved — a finish group
  // without a material has no effect in MaterialPicker.
  const resolvedPreselectFinishGroupId =
    resolvedPreselectMaterialId
      ? (preselectFinishGroupId ?? asset.recommendedCcFinishGroupId ?? undefined)
      : undefined;

  const configureHeader = (
    <div>
      <h1 className="text-2xl font-bold">
        Print: {asset.fileName || asset.originalFilename}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {asset.originalFilename} &middot;{" "}
        {(asset.fileSize / 1024 / 1024).toFixed(1)} MB
      </p>
      {(recommendedMaterial ||
        (asset.designTags && asset.designTags.length > 0)) && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Creator recommends:</span>
          {recommendedMaterial && (
            <div className="flex items-center gap-1.5">
              <div
                className="h-4 w-4 rounded-sm border border-border"
                style={{ backgroundColor: recommendedMaterial.color }}
              />
              <span className="font-medium">{recommendedMaterial.name}</span>
            </div>
          )}
          {asset.designTags?.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[10px]">
              {DESIGN_TAG_LABELS[tag] || tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <FileAssetPrintShell
        fileAssetId={asset.id}
        filename={asset.originalFilename}
        format={asset.format}
        hasCachedModel={!!asset.craftCloudModelId}
        geometryData={asset.geometryData}
        preselectMaterialId={resolvedPreselectMaterialId}
        preselectFinishGroupId={resolvedPreselectFinishGroupId}
        configureHeader={configureHeader}
        projectSlug={projectSlug}
        checkoutModel={getCheckoutModel()}
      />
    </div>
  );
}
