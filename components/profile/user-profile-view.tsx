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

/**
 * Server-rendered user profile body. Extracted from the old
 * `/u/[username]` route so the unified `/[handle]` catch-all can
 * delegate to it after resolving the handle. The old route lives on
 * as a permanent redirect for SEO / bookmark continuity.
 *
 * `handle` is the URL segment from the catch-all — it's already been
 * resolved to a `userId` by the caller, but we accept it as-is so
 * downstream links (tabs, redirect targets) keep the URL stable
 * without re-fetching the username.
 */
export async function UserProfileView({
  handle,
  searchParams,
}: {
  handle: string;
  searchParams: { tab?: string; welcome?: string; payment?: string };
}) {
  // auth() can throw "Clerk: auth() was called but Clerk can't detect
  // usage of clerkMiddleware()" when the proxy context is not set up
  // (Sentry 7488668107).  Profile pages are publicly viewable, so
  // falling back to anonymous (userId = null) is correct.
  let userId: string | null = null;
  try {
    ({ userId } = await auth());
  } catch {
    // proxy context absent — treat as anonymous visitor
  }
  const showWelcome =
    searchParams.welcome === "1" && searchParams.payment === "success";

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, handle));

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
    redirect(`/${handle}`);
  }

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

      <ProfileTabs
        username={handle}
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
