import Link from "next/link";
import { db } from "@/lib/db";
import {
  files,
  fileAssets,
  fileComments,
  fileDownloads,
  filePhotos,
  printOrderItems,
  printOrders,
  projectComments,
  projects,
  purchases,
  users,
} from "@/lib/db/schema";
import { eq, and, sum, count, isNull, inArray, desc, or } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { swallow } from "@/lib/utils/swallow";
import { PRINTED_STATUSES } from "@/lib/print-statuses";
import { timeAgo } from "@/lib/utils/time";

/**
 * Earnings + engagement at-a-glance for a creator.
 *
 * "Earnings" today is just file/project sales (creatorPayout column on
 * `purchases`). Until we wire paid file checkout, that number stays at
 * $0 for every user — so we surface the engagement metrics we *do*
 * have alongside it: prints / builds / comments / downloads on the
 * creator's listings. Once paid sales ship, the top stat becomes
 * meaningful and the rest stay useful.
 *
 * All queries are wrapped in `swallow()` so a transient Neon hiccup on
 * any one card doesn't 500 the tab.
 */
export async function EarningsTab({ userId }: { userId: string }) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  // Owned listings — needed for several engagement queries that count
  // events on the creator's files / projects.
  const [ownedFiles, ownedProjects] = await Promise.all([
    swallow(
      db
        .select({ id: files.id })
        .from(files)
        .where(eq(files.userId, userId))
    ),
    swallow(
      db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.userId, userId))
    ),
  ]);
  const fileIds = ownedFiles.map((r) => r.id);
  const projectIds = ownedProjects.map((r) => r.id);

  // printOrders.fileAssetId / printOrderItems.fileAssetId are FKs to
  // fileAssets.id, NOT files.id — an independent UUID space. Resolve
  // the creator's fileAssets rows here so the print-count queries
  // below can filter on the right id space (mirrors the pattern in
  // app/(app)/files/[slug]/page.tsx:359,403). Joining printOrders
  // directly to files.id (the old code) essentially never matches,
  // which is why "Prints" always reported ~0.
  const ownedFileAssets =
    fileIds.length === 0
      ? []
      : await swallow(
          db
            .select({ id: fileAssets.id })
            .from(fileAssets)
            .where(inArray(fileAssets.fileId, fileIds))
        );
  const assetIds = ownedFileAssets.map((r) => r.id);

  const [
    fileEarnings,
    projectEarnings,
    fileRefunds,
    projectRefunds,
    fileSalesActivity,
    projectSalesActivity,
    downloadTotal,
    printTotalLegacy,
    printTotalItems,
    fileCommentTotal,
    projectCommentTotal,
    buildTotal,
  ] = await Promise.all([
    swallow(
      db
        .select({ total: sum(purchases.creatorPayout) })
        .from(purchases)
        .innerJoin(files, eq(purchases.fileId, files.id))
        .where(
          and(eq(files.userId, userId), eq(purchases.status, "completed"))
        )
    ),
    // Project sales were missing from "Total earnings" before this
    // sweep — purchases.projectId rows never got summed in. Fixed by
    // joining through projects in a parallel query and adding the
    // total below.
    swallow(
      db
        .select({ total: sum(purchases.creatorPayout) })
        .from(purchases)
        .innerJoin(projects, eq(purchases.projectId, projects.id))
        .where(
          and(eq(projects.userId, userId), eq(purchases.status, "completed"))
        )
    ),
    swallow(
      db
        .select({ total: sum(purchases.creatorPayout) })
        .from(purchases)
        .innerJoin(files, eq(purchases.fileId, files.id))
        .where(
          and(eq(files.userId, userId), eq(purchases.status, "refunded"))
        )
    ),
    swallow(
      db
        .select({ total: sum(purchases.creatorPayout) })
        .from(purchases)
        .innerJoin(projects, eq(purchases.projectId, projects.id))
        .where(
          and(eq(projects.userId, userId), eq(purchases.status, "refunded"))
        )
    ),
    // Recent sales / refunds — chronological list of purchase events
    // for the activity table below. Pull the listing name + slug
    // inline so the renderer doesn't have to look up each row. Limit
    // to a generous 30 per side; merged + sliced to 20 on the
    // client.
    swallow(
      db
        .select({
          id: purchases.id,
          amount: purchases.creatorPayout,
          status: purchases.status,
          createdAt: purchases.createdAt,
          listingName: files.name,
          listingSlug: files.slug,
        })
        .from(purchases)
        .innerJoin(files, eq(purchases.fileId, files.id))
        .where(
          and(
            eq(files.userId, userId),
            or(
              eq(purchases.status, "completed"),
              eq(purchases.status, "refunded")
            )
          )
        )
        .orderBy(desc(purchases.createdAt))
        .limit(30)
    ),
    swallow(
      db
        .select({
          id: purchases.id,
          amount: purchases.creatorPayout,
          status: purchases.status,
          createdAt: purchases.createdAt,
          listingName: projects.name,
          listingSlug: projects.slug,
        })
        .from(purchases)
        .innerJoin(projects, eq(purchases.projectId, projects.id))
        .where(
          and(
            eq(projects.userId, userId),
            or(
              eq(purchases.status, "completed"),
              eq(purchases.status, "refunded")
            )
          )
        )
        .orderBy(desc(purchases.createdAt))
        .limit(30)
    ),
    fileIds.length === 0
      ? Promise.resolve([{ value: 0 }])
      : swallow(
          db
            .select({ value: count() })
            .from(fileDownloads)
            .where(inArray(fileDownloads.fileId, fileIds))
        ),
    assetIds.length === 0
      ? Promise.resolve([{ value: 0 }])
      : swallow(
          db
            .select({ value: count() })
            .from(printOrders)
            .where(
              and(
                inArray(printOrders.fileAssetId, assetIds),
                inArray(printOrders.status, [...PRINTED_STATUSES])
              )
            )
        ),
    assetIds.length === 0
      ? Promise.resolve([{ value: 0 }])
      : swallow(
          db
            .select({ value: count() })
            .from(printOrderItems)
            .innerJoin(
              printOrders,
              eq(printOrderItems.printOrderId, printOrders.id)
            )
            .where(
              and(
                inArray(printOrderItems.fileAssetId, assetIds),
                inArray(printOrders.status, [...PRINTED_STATUSES])
              )
            )
        ),
    fileIds.length === 0
      ? Promise.resolve([{ value: 0 }])
      : swallow(
          db
            .select({ value: count() })
            .from(fileComments)
            .where(
              and(
                inArray(fileComments.fileId, fileIds),
                isNull(fileComments.deletedAt)
              )
            )
        ),
    projectIds.length === 0
      ? Promise.resolve([{ value: 0 }])
      : swallow(
          db
            .select({ value: count() })
            .from(projectComments)
            .where(
              and(
                inArray(projectComments.projectId, projectIds),
                isNull(projectComments.deletedAt)
              )
            )
        ),
    fileIds.length === 0
      ? Promise.resolve([{ value: 0 }])
      : swallow(
          db
            .select({ value: count() })
            .from(filePhotos)
            .where(
              and(
                inArray(filePhotos.fileId, fileIds),
                eq(filePhotos.kind, "build")
              )
            )
        ),
  ]);

  // Sum gross sales across both listing kinds. Project sales used to
  // be silently dropped; now they roll up too.
  const totalEarnings =
    Number(fileEarnings[0]?.total ?? 0) +
    Number(projectEarnings[0]?.total ?? 0);
  const totalRefunded =
    Number(fileRefunds[0]?.total ?? 0) +
    Number(projectRefunds[0]?.total ?? 0);
  const netEarnings = totalEarnings - totalRefunded;

  // Interleave file + project sales activity by createdAt desc.
  type Activity = {
    id: string;
    amount: number;
    status: "completed" | "refunded";
    createdAt: Date;
    listingType: "file" | "project";
    listingName: string;
    listingSlug: string;
  };
  const recentActivity: Activity[] = [
    ...fileSalesActivity.map((row) => ({
      ...row,
      status: row.status as "completed" | "refunded",
      listingType: "file" as const,
    })),
    ...projectSalesActivity.map((row) => ({
      ...row,
      status: row.status as "completed" | "refunded",
      listingType: "project" as const,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 20);

  const downloads = Number(downloadTotal[0]?.value ?? 0);
  const printsTotal =
    Number(printTotalLegacy[0]?.value ?? 0) +
    Number(printTotalItems[0]?.value ?? 0);
  const commentsTotal =
    Number(fileCommentTotal[0]?.value ?? 0) +
    Number(projectCommentTotal[0]?.value ?? 0);
  const builds = Number(buildTotal[0]?.value ?? 0);
  const hasStripe = user?.stripeOnboardingComplete;

  return (
    <div className="space-y-6">
      {!hasStripe && (
        <Alert className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Set up Stripe to receive payouts from file and project sales.
          </p>
          <Button
            size="sm"
            className="mt-2"
            render={<Link href="/dashboard/settings/payouts" />}
          >
            Set up payouts
          </Button>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Net earnings</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              ${(netEarnings / 100).toFixed(2)}
            </p>
            {netEarnings === 0 && totalEarnings === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                No sales yet. Share your listings to start earning.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Gross sales</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              ${(totalEarnings / 100).toFixed(2)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Before refunds
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Refunded</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-destructive">
              −${(totalRefunded / 100).toFixed(2)}
            </p>
            {totalRefunded === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Nothing refunded
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {recentActivity.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-medium">Recent sales</h3>
          <Card className="gap-0 py-0 overflow-hidden">
            <div>
              {recentActivity.map((a) => {
                const isRefund = a.status === "refunded";
                const href =
                  a.listingType === "file"
                    ? `/files/${a.listingSlug}`
                    : `/projects/${a.listingSlug}`;
                return (
                  <Link
                    key={a.id}
                    href={href}
                    className="flex items-center justify-between gap-4 border-b border-border/60 px-4 py-3 last:border-b-0 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {a.listingName}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground capitalize">
                        {a.listingType} · {isRefund ? "Refund" : "Sale"} ·{" "}
                        {timeAgo(a.createdAt)}
                      </p>
                    </div>
                    <p
                      className={`shrink-0 text-sm font-medium tabular-nums ${
                        isRefund ? "text-destructive" : ""
                      }`}
                    >
                      {isRefund ? "−" : "+"}${(a.amount / 100).toFixed(2)}
                    </p>
                  </Link>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      <div>
        <h3 className="mb-3 text-sm font-medium">Engagement</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Prints"
            value={printsTotal}
            href={null}
            hint="Print orders on your files"
          />
          <StatCard
            label="Downloads"
            value={downloads}
            href={null}
            hint="Logged downloads on your files"
          />
          <StatCard
            label="Comments"
            value={commentsTotal}
            href="/dashboard/comments"
            hint="On your files + projects"
          />
          <StatCard
            label="Builds"
            value={builds}
            href={null}
            hint="Community-printed photos"
          />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: number;
  hint: string;
  href: string | null;
}) {
  const inner = (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {value.toLocaleString()}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-80">
      {inner}
    </Link>
  ) : (
    inner
  );
}
