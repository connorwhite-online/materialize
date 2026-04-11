import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files, purchases } from "@/lib/db/schema";
import { eq, and, count } from "drizzle-orm";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const [uploadCount] = await db
    .select({ count: count() })
    .from(files)
    .where(eq(files.userId, userId));

  const [libraryCount] = await db
    .select({ count: count() })
    .from(purchases)
    .where(and(eq(purchases.buyerId, userId), eq(purchases.status, "completed")));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-foreground/10 p-6">
          <p className="text-sm text-foreground/60">Your Uploads</p>
          <p className="mt-1 text-3xl font-semibold">
            {uploadCount?.count ?? 0}
          </p>
          <Link
            href="/dashboard/uploads"
            className="mt-3 inline-block text-sm underline"
          >
            Manage uploads
          </Link>
        </div>
        <div className="rounded-lg border border-foreground/10 p-6">
          <p className="text-sm text-foreground/60">My Library</p>
          <p className="mt-1 text-3xl font-semibold">
            {libraryCount?.count ?? 0}
          </p>
          <Link
            href="/dashboard/library"
            className="mt-3 inline-block text-sm underline"
          >
            View library
          </Link>
        </div>
        <div className="rounded-lg border border-foreground/10 p-6">
          <p className="text-sm text-foreground/60">Print Orders</p>
          <p className="mt-1 text-3xl font-semibold">0</p>
          <Link
            href="/dashboard/orders"
            className="mt-3 inline-block text-sm underline"
          >
            View orders
          </Link>
        </div>
        <div className="rounded-lg border border-foreground/10 p-6">
          <p className="text-sm text-foreground/60">Earnings</p>
          <p className="mt-1 text-3xl font-semibold">$0.00</p>
          <Link
            href="/dashboard/earnings"
            className="mt-3 inline-block text-sm underline"
          >
            View earnings
          </Link>
        </div>
      </div>
      <div className="mt-8">
        <Link
          href="/dashboard/uploads/new"
          className="inline-flex items-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
        >
          Upload a file
        </Link>
      </div>
    </div>
  );
}
