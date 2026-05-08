import Link from "next/link";
import { db } from "@/lib/db";
import {
  files,
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
import { eq, and, sum, count, isNull, inArray } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { swallow } from "@/lib/utils/swallow";
import { PRINTED_STATUSES } from "@/lib/print-statuses";

/**
 * Earnings + engagement at-a-glance for a creator.
 *
 * "Earnings" today is just file/project sales (creatorPayout column on
 * `purchases`). Until we wire paid file checkout, that number stays at
 * $0 for every user — so we surface the engagement metrics we *do*
 * have alongside it: prints / makes / comments / downloads on the
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

  const [
    earnings,
    downloadTotal,
    printTotalLegacy,
    printTotalItems,
    fileCommentTotal,
    projectCommentTotal,
    makeTotal,
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
    fileIds.length === 0
      ? Promise.resolve([{ value: 0 }])
      : swallow(
          db
            .select({ value: count() })
            .from(fileDownloads)
            .where(inArray(fileDownloads.fileId, fileIds))
        ),
    fileIds.length === 0
      ? Promise.resolve([{ value: 0 }])
      : swallow(
          db
            .select({ value: count() })
            .from(printOrders)
            .innerJoin(files, eq(printOrders.fileAssetId, files.id))
            .where(
              and(
                inArray(files.id, fileIds),
                inArray(printOrders.status, [...PRINTED_STATUSES])
              )
            )
        ),
    fileIds.length === 0
      ? Promise.resolve([{ value: 0 }])
      : swallow(
          db
            .select({ value: count() })
            .from(printOrderItems)
            .innerJoin(
              printOrders,
              eq(printOrderItems.printOrderId, printOrders.id)
            )
            .innerJoin(files, eq(printOrderItems.fileAssetId, files.id))
            .where(
              and(
                inArray(files.id, fileIds),
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
                eq(filePhotos.kind, "make")
              )
            )
        ),
  ]);

  const totalEarnings = Number(earnings[0]?.total ?? 0);
  const downloads = Number(downloadTotal[0]?.value ?? 0);
  const printsTotal =
    Number(printTotalLegacy[0]?.value ?? 0) +
    Number(printTotalItems[0]?.value ?? 0);
  const commentsTotal =
    Number(fileCommentTotal[0]?.value ?? 0) +
    Number(projectCommentTotal[0]?.value ?? 0);
  const makes = Number(makeTotal[0]?.value ?? 0);
  const hasStripe = user?.stripeOnboardingComplete;

  return (
    <div className="space-y-6">
      {!hasStripe && (
        <Alert className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Set up Stripe to receive payouts from file sales.
          </p>
          <Button size="sm" className="mt-2">
            Set up payouts
          </Button>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Total earnings</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              ${(totalEarnings / 100).toFixed(2)}
            </p>
            {totalEarnings === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                No file sales yet. Share your listings to start earning.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Pending payout</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">$0.00</p>
          </CardContent>
        </Card>
      </div>

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
            label="Makes"
            value={makes}
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
