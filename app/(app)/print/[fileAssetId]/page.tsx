import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { FileAssetPrintShell } from "@/components/print/file-asset-print-shell";
import { getMaterialById } from "@/lib/materials";
import { Badge } from "@/components/ui/badge";

const DESIGN_TAG_LABELS: Record<string, string> = {
  strong: "Strong",
  flexible: "Flexible",
  "heat-resistant": "Heat Resistant",
  watertight: "Watertight",
  detailed: "Detailed",
  lightweight: "Lightweight",
};

export default async function PrintConfigPage(props: {
  params: Promise<{ fileAssetId: string }>;
  searchParams: Promise<{ material?: string }>;
}) {
  const { fileAssetId } = await props.params;
  // CraftCloud material id threaded from /materials/[slug]'s
  // "Print with X" link. Forwarded to MaterialPicker's preselect
  // effect; exact-id match is reliable since it came from the
  // same catalog the quote route enriches against.
  const { material: preselectMaterialId } = await props.searchParams;

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
      recommendedMaterialId: files.recommendedMaterialId,
      designTags: files.designTags,
      minWallThickness: files.minWallThickness,
    })
    .from(fileAssets)
    .leftJoin(files, eq(fileAssets.fileId, files.id))
    .where(eq(fileAssets.id, fileAssetId));

  if (!asset) notFound();

  const recommendedMaterial = asset.recommendedMaterialId
    ? getMaterialById(asset.recommendedMaterialId)
    : null;

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
        preselectMaterialId={preselectMaterialId}
        configureHeader={configureHeader}
      />
    </div>
  );
}
