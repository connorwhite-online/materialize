import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files, fileAssets, purchases } from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { getMaterialById } from "@/lib/materials";
import { Badge } from "@/components/ui/badge";

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
  const material = materialId ? getMaterialById(materialId) : null;

  const { userId } = await auth();
  const tiles = userId ? await loadLibraryTiles(userId) : [];

  // Carry the material query through to the configurator so the picked
  // material can be auto-selected once quotes load.
  const linkSuffix = material ? `?material=${material.id}` : "";

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold">
        {material ? `Print with ${material.name}` : "Print a File"}
      </h1>
      <p className="mt-2 text-muted-foreground">
        {material
          ? "Pick one of your files or upload a new one — we'll quote it in this material."
          : "Get instant quotes from professional manufacturers worldwide."}
      </p>

      {tiles.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-muted-foreground">
            From your library
          </h2>
          <div className="mt-3 grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {tiles.map((tile) => (
              <Link
                key={tile.fileAssetId}
                href={`/print/${tile.fileAssetId}${linkSuffix}`}
                className="group"
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted/60 to-muted/30 transition-colors group-hover:border-primary/40">
                  {tile.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={tile.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-wider text-muted-foreground/40">
                      .{tile.format}
                    </div>
                  )}
                  {tile.source === "purchased" && (
                    <Badge
                      variant="secondary"
                      className="absolute left-1 top-1 text-[9px]"
                    >
                      Purchased
                    </Badge>
                  )}
                </div>
                <p className="mt-1.5 truncate text-xs text-foreground/80 group-hover:text-primary">
                  {tile.name}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Link href="/dashboard/uploads/new">
          <Card className="h-full transition-colors hover:border-primary/30">
            <CardContent className="flex flex-col items-center p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <span className="text-xl text-muted-foreground">+</span>
              </div>
              <h2 className="mt-4 font-semibold">Upload a new file</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload your STL, OBJ, 3MF, STEP, or AMF file
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/files">
          <Card className="h-full transition-colors hover:border-primary/30">
            <CardContent className="flex flex-col items-center p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <span className="text-xl text-muted-foreground">&#x2315;</span>
              </div>
              <h2 className="mt-4 font-semibold">Browse marketplace</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Find a file to print from the community
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
