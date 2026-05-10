import type { Metadata } from "next";
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
import { LibraryTab } from "@/components/profile/library-tab";
import { OrdersTab } from "@/components/profile/orders-tab";
import { EarningsTab } from "@/components/profile/earnings-tab";
import { NotificationsTab } from "@/components/profile/notifications-tab";
import { getMyUnreadNotificationCount } from "@/lib/notifications/queries";
import { profilePageJsonLd } from "@/lib/seo/json-ld";

const PLATFORM_LABELS: Record<string, string> = {
  twitter: "X / Twitter",
  github: "GitHub",
  instagram: "Instagram",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  website: "Website",
};

type Tab = "library" | "orders" | "earnings" | "notifications";

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

export async function generateMetadata(props: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await props.params;
  const [user] = await db
    .select({
      username: users.username,
      displayName: users.displayName,
      bio: users.bio,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.username, username));

  if (!user) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }

  const name = user.displayName || user.username || username;
  const handle = user.username ? `@${user.username}` : username;
  const description = truncate(
    user.bio?.trim() || `${name} (${handle}) on Materialize — 3D-print files and projects.`,
    155
  );
  const url = `/u/${username}`;

  // og:image / twitter:image are emitted by opengraph-image.tsx in
  // this segment — leave them off here to avoid duplicate tags.
  return {
    title: name,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "profile",
      title: name,
      description,
      url,
      username: user.username ?? undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: name,
      description,
    },
  };
}

export default async function ProfilePage(props: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string; welcome?: string; payment?: string }>;
}) {
  const { username } = await props.params;
  const searchParams = await props.searchParams;
  const { userId } = await auth();
  const showWelcome =
    searchParams.welcome === "1" && searchParams.payment === "success";

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username));

  if (!user) notFound();

  const isOwner = userId === user.id;
  // Accept the legacy "comments" key as an alias for "notifications" so
  // any old bookmarks land on the inbox instead of bouncing to Library.
  const rawTab = searchParams.tab;
  const activeTab: Tab =
    rawTab === "orders" || rawTab === "earnings"
      ? rawTab
      : rawTab === "notifications" || rawTab === "comments"
        ? "notifications"
        : "library";

  // Guard owner-only tabs
  if (
    !isOwner &&
    (activeTab === "orders" ||
      activeTab === "earnings" ||
      activeTab === "notifications")
  ) {
    redirect(`/u/${username}`);
  }

  // Owner-only — drives the dot on the Notifications tab. Skipped for
  // anon viewers and non-owners since the tab itself is hidden then.
  const unreadNotifications = isOwner
    ? await getMyUnreadNotificationCount()
    : 0;

  const jsonLd = profilePageJsonLd({
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
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

      {showWelcome && isOwner && (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm font-medium">
            Welcome to Materialize — your order is in.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            We created an account for you so you can track this print and any
            future orders. Your email is already set up for status updates.
          </p>
        </div>
      )}

      {/* Tabs */}
      <ProfileTabs
        username={username}
        activeTab={activeTab}
        isOwner={isOwner}
        unreadNotifications={unreadNotifications}
      />

      <div className="mt-6">
        {activeTab === "library" && (
          <LibraryTab userId={user.id} isOwner={isOwner} />
        )}
        {activeTab === "orders" && isOwner && <OrdersTab userId={user.id} />}
        {activeTab === "notifications" && isOwner && (
          <NotificationsTab userId={user.id} />
        )}
        {activeTab === "earnings" && isOwner && <EarningsTab userId={user.id} />}
      </div>
    </div>
  );
}
