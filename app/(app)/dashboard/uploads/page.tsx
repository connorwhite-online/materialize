import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export default async function UploadsPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const userFiles = await db
    .select()
    .from(files)
    .where(eq(files.userId, userId))
    .orderBy(desc(files.createdAt));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your Uploads</h1>
        <Link
          href="/dashboard/uploads/new"
          className="inline-flex items-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
        >
          Upload new file
        </Link>
      </div>
      {userFiles.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-foreground/60">
            No uploads yet. Upload your first 3D file to get started.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {userFiles.map((file) => (
            <div
              key={file.id}
              className="rounded-lg border border-foreground/10 p-4"
            >
              <div className="aspect-square rounded-md bg-foreground/5" />
              <h3 className="mt-3 font-medium">{file.name}</h3>
              <div className="mt-1 flex items-center gap-2 text-sm text-foreground/60">
                <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-xs">
                  {file.status}
                </span>
                {file.price > 0 ? (
                  <span>${(file.price / 100).toFixed(2)}</span>
                ) : (
                  <span>Free</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
