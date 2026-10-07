"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { UserAvatar } from "@/components/auth/user-avatar";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/utils/time";

export type ActivityUser = {
  id: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

export type PrintActivity = {
  id: string;
  user: ActivityUser;
  materialLabel: string | null;
  vendorName: string | null;
  status: string;
  createdAt: Date | string;
};

export type DownloadActivity = {
  id: string;
  user: ActivityUser;
  createdAt: Date | string;
};

const STATUS_LABEL: Record<string, string> = {
  auto_approved: "Confirmed",
  ordered: "Confirmed",
  in_production: "In production",
  shipped: "Shipped",
  received: "Delivered",
};

/** Rows shown before "Show all": enough to prove life, not a ledger. */
const PREVIEW_ROWS = 5;

function Avatar({ user }: { user: ActivityUser }) {
  const name = user.displayName || user.username || "Anonymous";
  // Fall back to a stable anon seed so all unsigned-in downloads share
  // one gradient rather than each producing a random one. The gradient
  // is deterministic from the seed — see `getAvatarGradient`.
  const seed = user.username || user.id || "anonymous";
  return (
    <UserAvatar
      seed={seed}
      imageUrl={user.avatarUrl}
      displayName={name}
      className="size-8 shrink-0 text-[11px]"
    />
  );
}

function Name({ user }: { user: ActivityUser }) {
  const name = user.displayName || user.username || "Anonymous";
  return user.username ? (
    <Link
      href={`/${user.username}`}
      className="truncate text-sm leading-5 font-medium underline-offset-4 hover:underline"
    >
      {name}
    </Link>
  ) : (
    <span className="truncate text-sm leading-5 font-medium">{name}</span>
  );
}

const ROW_CLASS = "flex items-center gap-3 py-2.5";

function PrintRow({ row }: { row: PrintActivity }) {
  const statusLabel = STATUS_LABEL[row.status] ?? row.status;
  const detail = [row.materialLabel, row.vendorName && `via ${row.vendorName}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className={ROW_CLASS}>
      <Avatar user={row.user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Name user={row.user} />
        {detail && (
          <span className="truncate text-[13px] leading-[18px] text-muted-foreground">
            {detail}
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <span className="text-[13px] leading-5">{statusLabel}</span>
        <span className="text-xs leading-[18px] text-subtle-foreground tabular-nums">
          {timeAgo(row.createdAt)}
        </span>
      </div>
    </li>
  );
}

function DownloadRow({ row }: { row: DownloadActivity }) {
  return (
    <li className={ROW_CLASS}>
      <Avatar user={row.user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Name user={row.user} />
      </div>
      <span className="shrink-0 text-xs text-subtle-foreground tabular-nums">
        {timeAgo(row.createdAt)}
      </span>
    </li>
  );
}

function RowList<T extends { id: string }>({
  rows,
  empty,
  render,
}: {
  rows: T[];
  empty: string;
  render: (row: T) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">{empty}</p>
    );
  }
  const shown = expanded ? rows : rows.slice(0, PREVIEW_ROWS);
  return (
    <div className="flex flex-col items-start">
      <ul className="w-full divide-y divide-border">{shown.map(render)}</ul>
      {rows.length > PREVIEW_ROWS && (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 mt-1 text-muted-foreground"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? "Show less" : `Show all ${rows.length}`}
        </Button>
      )}
    </div>
  );
}

/**
 * Who printed and downloaded this file. A plain section (title, pill
 * tabs, hairline rows), not a tinted card: it is a list of people, and
 * the rows themselves carry the structure. Material and vendor sit
 * under the name instead of in a badge column, so they survive on a
 * phone rather than being hidden there.
 */
export function FileActivity({
  prints,
  downloads,
}: {
  prints: PrintActivity[];
  downloads: DownloadActivity[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <Tabs defaultValue="prints" className="gap-0">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
          <h2 className="text-base leading-6 font-semibold">Activity</h2>
          <TabsList>
            <TabsTrigger value="prints">
              Printed
              <span className="ml-1.5 text-muted-foreground tabular-nums">
                {prints.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="downloads">
              Downloaded
              <span className="ml-1.5 text-muted-foreground tabular-nums">
                {downloads.length}
              </span>
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="prints" className="mt-0">
          <RowList
            rows={prints}
            empty="No prints yet."
            render={(row) => <PrintRow key={row.id} row={row} />}
          />
        </TabsContent>
        <TabsContent value="downloads" className="mt-0">
          <RowList
            rows={downloads}
            empty="No downloads yet."
            render={(row) => <DownloadRow key={row.id} row={row} />}
          />
        </TabsContent>
      </Tabs>
    </section>
  );
}
