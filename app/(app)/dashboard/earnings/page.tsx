import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files, purchases, users } from "@/lib/db/schema";
import { eq, and, sum } from "drizzle-orm";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export default async function EarningsPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId));

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
        <Alert className="mt-6 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Set up Stripe to receive payouts from file sales.
          </p>
          <Button size="sm" className="mt-2">
            Set up payouts
          </Button>
        </Alert>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Total Earnings</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              ${(totalEarnings / 100).toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Pending Payout</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">$0.00</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
