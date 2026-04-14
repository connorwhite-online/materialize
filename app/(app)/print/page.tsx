import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files, fileAssets, purchases } from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getCraftCloudCatalog } from "@/lib/craftcloud/catalog";
import { PrintPageContent } from "@/components/print/print-page-content";

interface LibraryTile {
  fileAssetId: string;
  name: string;
  thumbnailUrl: string | null;
  format: string;
  source: "owned" | "purchased";
}

async function loadLibraryTiles(userId: string): Promise<LibraryTile[]> {
  const ownedFiles = await db
    .select({
      id: files.id,
      name: files.name,
      thumbnailUrl: files.thumbnailUrl,
    })
    .from(files)
    .where(eq(files.userId, userId))
    .orderBy(desc(files.createdAt));

  const purchasedRows = await db
    .select({
      id: files.id,
      name: files.name,
      thumbnailUrl: files.thumbnailUrl,
    })
    .from(purchases)
    .innerJoin(files, eq(purchases.fileId, files.id))
    .where(
      and(eq(purchases.buyerId, userId), eq(purchases.status, "completed"))
    );

  const fileIds = [
    ...ownedFiles.map((f) => f.id),
    ...purchasedRows.map((r) => r.id),
  ];
  if (fileIds.length === 0) return [];

  const assetRows = await db
    .select({
      id: fileAssets.id,
      fileId: fileAssets.fileId,
      format: fileAssets.format,
      createdAt: fileAssets.createdAt,
    })
    .from(fileAssets)
    .where(inArray(fileAssets.fileId, fileIds))
    .orderBy(fileAssets.createdAt);

  // First (oldest) asset wins as the primary print target.
  const primaryByFileId = new Map<string, { id: string; format: string }>();
  for (const row of assetRows) {
    if (!row.fileId || primaryByFileId.has(row.fileId)) continue;
    primaryByFileId.set(row.fileId, { id: row.id, format: row.format });
  }

  const tiles: LibraryTile[] = [];
  for (const f of ownedFiles) {
    const asset = primaryByFileId.get(f.id);
    if (!asset) continue;
    tiles.push({
      fileAssetId: asset.id,
      name: f.name,
      thumbnailUrl: f.thumbnailUrl,
      format: asset.format,
      source: "owned",
    });
  }
  for (const r of purchasedRows) {
    const asset = primaryByFileId.get(r.id);
    if (!asset) continue;
    tiles.push({
      fileAssetId: asset.id,
      name: r.name,
      thumbnailUrl: r.thumbnailUrl,
      format: asset.format,
      source: "purchased",
    });
  }
  return tiles;
}

export default async function PrintPage(props: {
  searchParams: Promise<{ material?: string }>;
}) {
  const searchParams = await props.searchParams;
  const materialId = searchParams.material;
  // The "Print with X" link on /materials/[slug] passes CraftCloud's
  // real material id, so we resolve it against the cached catalog
  // for the headline and then forward the same id downstream for
  // the material-step auto-skip.
  const material = materialId
    ? (await getCraftCloudCatalog()).materialById.get(materialId) ?? null
    : null;
  console.log("[/print] preselect resolve", {
    materialId,
    resolved: material ? { id: material.id, name: material.name } : null,
  });

  const { userId } = await auth();
  const tiles = userId ? await loadLibraryTiles(userId) : [];

  const linkSuffix = material ? `?material=${material.id}` : "";

  return (
    <PrintPageContent
      headline={material ? `Print with ${material.name}` : "Print a File"}
      subheadline={
        material
          ? "Pick one of your files or upload a new one — we'll quote it in this material."
          : "Get instant quotes from professional manufacturers worldwide."
      }
      tiles={tiles}
      linkSuffix={linkSuffix}
      preselectMaterialId={material?.id}
    />
  );
}
