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
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/components/ui/summary-list";
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
  // Only the column this tab reads — a bare select() pulled every users
  // column, so any column a stale DB lacked took the whole page down.
  const [user] = await swallow(
    db
      .select({ stripeOnboardingComplete: users.stripeOnboardingComplete })
      .from(users)
      .where(eq(users.id, userId))
  );

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
    <div className="flex flex-col gap-10">
      {!hasStripe && (
        <div className="flex flex-col gap-3 rounded-2xl bg-muted px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm leading-5 font-medium">
              Payouts aren&apos;t set up
            </p>
            <p className="text-[13px] leading-[18px] text-muted-foreground">
              Connect Stripe to get paid for file and project sales.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-fit shrink-0"
            render={<Link href="/dashboard/settings/payouts" />}
          >
            Set up payouts
          </Button>
        </div>
      )}

      {/* One headline number with its breakdown underneath, instead of
          three equal cards competing — net is the number people mean. */}
      <section className="flex flex-col gap-1">
        <p className="text-[13px] text-muted-foreground">Net earnings</p>
        <p className="text-4xl leading-none font-semibold tabular-nums">
          {formatUsd(netEarnings)}
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground tabular-nums">
          {totalEarnings === 0 && totalRefunded === 0 ? (
            "No sales yet. Share a listing to make your first one."
          ) : (
            <>
              {formatUsd(totalEarnings)} gross
              {" · "}
              <span className={totalRefunded > 0 ? "text-destructive" : ""}>
                {formatUsd(totalRefunded)} refunded
              </span>
            </>
          )}
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base leading-6 font-semibold">Engagement</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Stat label="Prints" value={printsTotal} hint="Orders of your files" />
          <Stat label="Downloads" value={downloads} hint="Of your files" />
          <Stat
            label="Comments"
            value={commentsTotal}
            hint="On files and projects"
            href="/notifications"
          />
          <Stat label="Builds" value={builds} hint="Community photos" />
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base leading-6 font-semibold">Recent sales</h2>
        {recentActivity.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sales and refunds will show up here.
          </p>
        ) : (
          <ul className="-mx-3 flex flex-col">
            {recentActivity.map((a) => {
              const isRefund = a.status === "refunded";
              const href =
                a.listingType === "file"
                  ? `/files/${a.listingSlug}`
                  : `/projects/${a.listingSlug}`;
              return (
                <li key={a.id}>
                  <Link
                    href={href}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm leading-5 font-medium">
                        {a.listingName}
                      </p>
                      <p className="text-[13px] leading-[18px] text-muted-foreground">
                        {isRefund ? "Refund" : "Sale"} ·{" "}
                        {a.listingType === "file" ? "File" : "Project"} ·{" "}
                        {timeAgo(a.createdAt)}
                      </p>
                    </div>
                    <p
                      className={`shrink-0 text-sm font-medium tabular-nums ${
                        isRefund ? "text-destructive" : ""
                      }`}
                    >
                      {isRefund ? "−" : "+"}
                      {formatUsd(a.amount)}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: number;
  hint: string;
  href?: string;
}) {
  const number = (
    <span className="text-2xl leading-7 font-semibold tabular-nums">
      {value.toLocaleString()}
    </span>
  );
  return (
    <div className="flex flex-col gap-0.5 border-l border-border pl-4">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd>
        {href ? (
          <Link href={href} className="hover:underline hover:underline-offset-4">
            {number}
          </Link>
        ) : (
          number
        )}
      </dd>
      <dd className="text-xs text-subtle-foreground">{hint}</dd>
    </div>
  );
}
