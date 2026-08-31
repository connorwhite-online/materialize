import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { loadUserByHandle } from "@/app/(app)/[handle]/loader";
import { UserAvatar } from "@/components/auth/user-avatar";
import { LibraryTab } from "@/components/profile/library-tab";
import { OwnerSettingsTabs } from "@/components/profile/owner-settings-tabs";
import { resolveOwnerSettingsTab } from "@/lib/profile/owner-settings-tabs";
import { OwnerProfileHeadline } from "@/components/profile/owner-profile-headline";
import {
  AgentSettings,
  GeneralSettings,
  PaymentSettings,
} from "@/components/profile/general-settings";
import { profilePageJsonLd, safeJsonLdScript } from "@/lib/seo/json-ld";
import {
  SocialPlatformIcon,
  platformLabel,
  sortSocialLinks,
} from "@/components/profile/social-platforms";

const OWNER_TAB_REDIRECTS: Record<string, string> = {
  library: "/dashboard/library",
  files: "/dashboard/library",
  orders: "/dashboard/orders",
  earnings: "/dashboard/earnings",
  comments: "/notifications",
};

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
  searchParams: {
    tab?: string;
    welcome?: string;
    payment?: string;
    production?: string;
  };
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
  const user = await loadUserByHandle(handle);

  if (!user) notFound();

  const isOwner = userId === user.id;

  if (isOwner) {
    const rawTab = searchParams.tab;
    if (rawTab && rawTab in OWNER_TAB_REDIRECTS) {
      const dest = OWNER_TAB_REDIRECTS[rawTab];
      const query = new URLSearchParams();
      if (searchParams.welcome) query.set("welcome", searchParams.welcome);
      if (searchParams.payment) query.set("payment", searchParams.payment);
      if (searchParams.production)
        query.set("production", searchParams.production);
      const qs = query.toString();
      redirect(qs ? `${dest}?${qs}` : dest);
    }

    const [settings] = await db
      .select({
        defaultUploadVisibility: users.defaultUploadVisibility,
      })
      .from(users)
      .where(eq(users.id, user.id));

    const activeTab = resolveOwnerSettingsTab(rawTab);

    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <OwnerProfileHeadline
          username={user.username || handle}
          displayName={user.displayName || ""}
          bio={user.bio || ""}
          avatarUrl={user.avatarUrl}
          socialLinks={user.socialLinks ?? []}
        />
        <div className="mt-10">
          <OwnerSettingsTabs username={handle} activeTab={activeTab} />
          <div className="mt-8">
            {activeTab === "agents" ? (
              <AgentSettings />
            ) : activeTab === "payments" ? (
              <PaymentSettings />
            ) : (
              <GeneralSettings
                defaultUploadVisibility={
                  settings?.defaultUploadVisibility ?? "private"
                }
              />
            )}
          </div>
        </div>
      </div>
    );
  }

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
          dangerouslySetInnerHTML={{ __html: safeJsonLdScript(jsonLd) }}
        />
      )}
      <div className="space-y-3">
        <div className="flex items-start gap-6">
          <UserAvatar
            seed={user.username || user.id}
            imageUrl={user.avatarUrl}
            displayName={user.displayName || user.username}
            className="h-20 w-20 text-2xl"
          />
          <div className="min-w-0 flex-1">
            <div>
              <h1 className="text-2xl font-bold">
                {user.displayName || user.username}
              </h1>
              {user.username && (
                <p className="text-muted-foreground">@{user.username}</p>
              )}
            </div>
            {user.bio && (
              <p className="mt-2 max-w-xl text-sm leading-relaxed">{user.bio}</p>
            )}
          </div>
        </div>
        {user.socialLinks && user.socialLinks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {sortSocialLinks(user.socialLinks).map((link) => {
              const label = platformLabel(link.platform);
              return (
                <a
                  key={link.platform}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={label}
                  aria-label={label}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  <SocialPlatformIcon platform={link.platform} size={16} />
                </a>
              );
            })}
          </div>
        )}
      </div>

      <div className="my-6" />

      <LibraryTab userId={user.id} isOwner={false} />
    </div>
  );
}
