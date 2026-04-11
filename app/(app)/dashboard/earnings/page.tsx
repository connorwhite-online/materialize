import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files, purchases, users } from "@/lib/db/schema";
import { eq, and, sum } from "drizzle-orm";
import Link from "next/link";

export default async function EarningsPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId));

  // Sum payouts from completed purchases of this user's files
  const [earnings] = await db
    .select({ total: sum(purchases.creatorPayout) })
    .from(purchases)
    .innerJoin(files, eq(purchases.fileId, files.id))
    .where(
      and(eq(files.userId, userId), eq(purchases.status, "completed"))
    );

  const totalEarnings = Number(earnings?.total ?? 0);
  const hasStripe = user?.stripeOnboardingComplete;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold">Earnings</h1>

      {!hasStripe && (
        <div className="mt-6 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4">
          <p className="text-sm">
            Set up Stripe to receive payouts from file sales.
          </p>
          <Link
            href="/dashboard/earnings/onboard"
            className="mt-2 inline-block rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            Set up payouts
          </Link>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-foreground/10 p-6">
          <p className="text-sm text-foreground/60">Total Earnings</p>
          <p className="mt-1 text-3xl font-semibold">
            ${(totalEarnings / 100).toFixed(2)}
          </p>
        </div>
        <div className="rounded-lg border border-foreground/10 p-6">
          <p className="text-sm text-foreground/60">Pending Payout</p>
          <p className="mt-1 text-3xl font-semibold">$0.00</p>
        </div>
      </div>
    </div>
  );
}
