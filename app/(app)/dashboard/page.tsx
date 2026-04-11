import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files, purchases, printOrders } from "@/lib/db/schema";
import { eq, and, count } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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

  const [orderCount] = await db
    .select({ count: count() })
    .from(printOrders)
    .where(eq(printOrders.userId, userId));

  const stats = [
    { label: "Your Uploads", value: uploadCount?.count ?? 0, href: "/dashboard/uploads", action: "Manage" },
    { label: "My Library", value: libraryCount?.count ?? 0, href: "/dashboard/library", action: "View" },
    { label: "Print Orders", value: orderCount?.count ?? 0, href: "/dashboard/orders", action: "View" },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Link key={stat.href} href={stat.href}>
            <Card className="transition-colors hover:border-primary/30">
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums">
                  {stat.value}
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  {stat.action} &rarr;
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-8">
        <Button render={<Link href="/dashboard/uploads/new" />}>
          Upload a file
        </Button>
      </div>
    </div>
  );
}
