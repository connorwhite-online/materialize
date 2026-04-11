import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files, fileAssets, users, purchases } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {/* 3D Viewer placeholder — will be replaced with R3F viewer in Phase 3 */}
          <div className="aspect-[4/3] rounded-lg bg-foreground/5 flex items-center justify-center">
            <span className="text-foreground/40">3D Preview</span>
          </div>
          <div className="mt-6">
            <h1 className="text-2xl font-bold">{file.name}</h1>
            {file.description && (
              <p className="mt-2 text-foreground/70">{file.description}</p>
            )}
            {file.tags && file.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {file.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="mt-6">
            <h2 className="font-semibold">Files</h2>
            <div className="mt-2 space-y-2">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center justify-between rounded-md border border-foreground/10 px-4 py-2 text-sm"
                >
                  <div>
                    <span className="font-medium">
                      {asset.originalFilename}
                    </span>
                    <span className="ml-2 text-foreground/50 uppercase">
                      {asset.format}
                    </span>
                    <span className="ml-2 text-foreground/40">
                      {(asset.fileSize / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                  {canDownload && (
                    <a
                      href={`/files/${slug}/download?asset=${asset.id}`}
                      className="text-sm underline"
                    >
                      Download
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="rounded-lg border border-foreground/10 p-6">
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
                  className="font-medium hover:underline"
                >
                  {file.displayName || file.username}
                </Link>
              </div>
            </div>
            <div className="mt-4 border-t border-foreground/10 pt-4">
              {file.price > 0 ? (
                <>
                  <p className="text-2xl font-bold">
                    ${(file.price / 100).toFixed(2)}
                  </p>
                  {canDownload ? (
                    <a
                      href={`/files/${slug}/download`}
                      className="mt-3 block w-full rounded-md bg-foreground px-4 py-2 text-center text-sm font-medium text-background"
                    >
                      Download
                    </a>
                  ) : (
                    <form action={`/files/${slug}/purchase`} method="POST">
                      <button
                        type="submit"
                        className="mt-3 block w-full rounded-md bg-foreground px-4 py-2 text-center text-sm font-medium text-background"
                      >
                        Purchase
                      </button>
                    </form>
                  )}
                </>
              ) : (
                <>
                  <p className="text-lg font-medium text-foreground/60">Free</p>
                  <a
                    href={`/files/${slug}/download`}
                    className="mt-3 block w-full rounded-md bg-foreground px-4 py-2 text-center text-sm font-medium text-background"
                  >
                    Download
                  </a>
                </>
              )}
              <Link
                href={`/print/${assets[0]?.id}`}
                className="mt-2 block w-full rounded-md border border-foreground/20 px-4 py-2 text-center text-sm font-medium transition-colors hover:bg-foreground/5"
              >
                Print this file
              </Link>
            </div>
            <div className="mt-4 border-t border-foreground/10 pt-4 text-sm text-foreground/60">
              <p>License: {file.license}</p>
              <p>{file.downloadCount} downloads</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
