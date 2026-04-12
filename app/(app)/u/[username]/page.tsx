import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/auth/user-avatar";
import { ProfileTabs } from "@/components/profile/profile-tabs";
import { FilesTab } from "@/components/profile/files-tab";
import { LibraryTab } from "@/components/profile/library-tab";
import { OrdersTab } from "@/components/profile/orders-tab";
import { EarningsTab } from "@/components/profile/earnings-tab";

const PLATFORM_LABELS: Record<string, string> = {
  twitter: "X / Twitter",
  github: "GitHub",
  instagram: "Instagram",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  website: "Website",
};

type Tab = "files" | "library" | "orders" | "earnings";

export default async function ProfilePage(props: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { username } = await props.params;
  const searchParams = await props.searchParams;
  const { userId } = await auth();

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username));

  if (!user) notFound();

  const isOwner = userId === user.id;
  const activeTab: Tab = (searchParams.tab as Tab) || "files";

  // Guard owner-only tabs
  if (!isOwner && (activeTab === "library" || activeTab === "orders" || activeTab === "earnings")) {
    redirect(`/u/${username}`);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Profile header */}
      <div className="flex items-start gap-6">
        <UserAvatar
          seed={user.username || user.id}
          imageUrl={user.avatarUrl}
          displayName={user.displayName || user.username}
          className="h-20 w-20 text-2xl"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">
                {user.displayName || user.username}
              </h1>
              {user.username && (
                <p className="text-muted-foreground">@{user.username}</p>
              )}
            </div>
            {isOwner && (
              <Button
                variant="outline"
                size="sm"
                render={<Link href="/dashboard/settings" />}
              >
                Settings
              </Button>
            )}
          </div>
          {user.bio && (
            <p className="mt-2 max-w-xl text-sm leading-relaxed">{user.bio}</p>
          )}
          {user.socialLinks && user.socialLinks.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {user.socialLinks.map((link) => (
                <a
                  key={link.platform}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {PLATFORM_LABELS[link.platform] || link.platform}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      <Separator className="my-6" />

      {/* Tabs */}
      <ProfileTabs username={username} activeTab={activeTab} isOwner={isOwner} />

      <div className="mt-6">
        {activeTab === "files" && (
          <FilesTab userId={user.id} isOwner={isOwner} />
        )}
        {activeTab === "library" && isOwner && <LibraryTab userId={user.id} />}
        {activeTab === "orders" && isOwner && <OrdersTab userId={user.id} />}
        {activeTab === "earnings" && isOwner && <EarningsTab userId={user.id} />}
      </div>
    </div>
  );
}
