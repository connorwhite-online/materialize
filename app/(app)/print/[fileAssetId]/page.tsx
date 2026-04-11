import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { QuoteConfigurator } from "@/components/print/quote-configurator";

export default async function PrintConfigPage(props: {
  params: Promise<{ fileAssetId: string }>;
}) {
  const { fileAssetId } = await props.params;

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
    })
    .from(fileAssets)
    .leftJoin(files, eq(fileAssets.fileId, files.id))
    .where(eq(fileAssets.id, fileAssetId));

  if (!asset) notFound();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold">
        Print: {asset.fileName || asset.originalFilename}
      </h1>
      <p className="mt-1 text-sm text-foreground/60">
        {asset.originalFilename} &middot;{" "}
        {(asset.fileSize / 1024 / 1024).toFixed(1)} MB
      </p>

      <div className="mt-6">
        <QuoteConfigurator
          fileAssetId={asset.id}
          filename={asset.originalFilename}
          format={asset.format}
          geometryData={asset.geometryData}
        />
      </div>
    </div>
  );
}
