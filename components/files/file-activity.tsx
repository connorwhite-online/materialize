"use client";

import Link from "next/link";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { UserAvatar } from "@/components/auth/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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

function UserCell({ user }: { user: ActivityUser }) {
  const name = user.displayName || user.username || "Anonymous";
  // Fall back to a stable anon seed so all unsigned-in downloads share
  // one gradient rather than each producing a random one. The gradient
  // is deterministic from the seed — see `getAvatarGradient`.
  const seed = user.username || user.id || "anonymous";
  const inner = (
    <div className="flex items-center gap-2.5 min-w-0">
      <UserAvatar
        seed={seed}
        imageUrl={user.avatarUrl}
        displayName={name}
        className="h-6 w-6 text-[10px]"
      />
      <span className="text-sm font-medium truncate">{name}</span>
    </div>
  );
  return user.username ? (
    <Link
      href={`/u/${user.username}`}
      className="hover:opacity-80 transition-opacity min-w-0"
    >
      {inner}
    </Link>
  ) : (
    <div className="min-w-0">{inner}</div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function PrintRow({ row }: { row: PrintActivity }) {
  const statusLabel = STATUS_LABEL[row.status] ?? row.status;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/60 last:border-b-0">
      <div className="flex-1 min-w-0">
        <UserCell user={row.user} />
      </div>
      <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
        {row.materialLabel && (
          <Badge variant="secondary" className="text-[10px] truncate max-w-[160px]">
            {row.materialLabel}
          </Badge>
        )}
        {row.vendorName && (
          <span className="truncate max-w-[120px]">via {row.vendorName}</span>
        )}
      </div>
      <Badge variant="outline" className="text-[10px] shrink-0">
        {statusLabel}
      </Badge>
      <span className="text-xs text-muted-foreground shrink-0 tabular-nums w-14 text-right">
        {timeAgo(row.createdAt)}
      </span>
    </div>
  );
}

function DownloadRow({ row }: { row: DownloadActivity }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/60 last:border-b-0">
      <div className="flex-1 min-w-0">
        <UserCell user={row.user} />
      </div>
      <span className="text-xs text-muted-foreground shrink-0 tabular-nums w-14 text-right">
        {timeAgo(row.createdAt)}
      </span>
    </div>
  );
}

export function FileActivity({
  prints,
  downloads,
}: {
  prints: PrintActivity[];
  downloads: DownloadActivity[];
}) {
  return (
    <Card className="gap-0 py-0 overflow-hidden">
      <Tabs defaultValue="prints" className="gap-0">
        <div className="px-4 pt-4 pb-3 border-b border-border/60 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Activity</h2>
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
          {prints.length === 0 ? (
            <EmptyState>No prints yet.</EmptyState>
          ) : (
            <div>
              {prints.map((row) => (
                <PrintRow key={row.id} row={row} />
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="downloads" className="mt-0">
          {downloads.length === 0 ? (
            <EmptyState>No downloads yet.</EmptyState>
          ) : (
            <div>
              {downloads.map((row) => (
                <DownloadRow key={row.id} row={row} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}
