import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { loadUserByHandle } from "@/app/(app)/[handle]/loader";
import { UserAvatar } from "@/components/auth/user-avatar";
import { Page } from "@/components/ui/page";
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
      <Page width="narrow" className="gap-10">
        <OwnerProfileHeadline
          username={user.username || handle}
          displayName={user.displayName || ""}
          bio={user.bio || ""}
          avatarUrl={user.avatarUrl}
        />
        <div className="flex flex-col gap-8">
          <OwnerSettingsTabs username={handle} activeTab={activeTab} />
          {activeTab === "agents" ? (
            <AgentSettings userId={user.id} />
          ) : activeTab === "payments" ? (
            <PaymentSettings userId={user.id} />
          ) : (
            <GeneralSettings
              defaultUploadVisibility={
                settings?.defaultUploadVisibility ?? "private"
              }
              socialLinks={user.socialLinks ?? []}
            />
          )}
        </div>
      </Page>
    );
  }

  const jsonLd = profilePageJsonLd({
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
  });

  const name = user.displayName || user.username;
  const links = sortSocialLinks(user.socialLinks ?? []);

  return (
    <Page width="wide" className="gap-10">
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdScript(jsonLd) }}
        />
      )}
      <header className="flex items-center gap-4 sm:gap-6">
        <UserAvatar
          seed={user.username || user.id}
          imageUrl={user.avatarUrl}
          displayName={name}
          className="size-16 shrink-0 text-2xl sm:size-20"
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl leading-7 font-semibold">{name}</h1>
          {user.username && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              @{user.username}
            </p>
          )}
          {user.bio && (
            <p className="mt-2 max-w-xl text-sm leading-5 text-pretty">
              {user.bio}
            </p>
          )}
          {links.length > 0 && (
            <ul className="mt-3 -ml-2 flex flex-wrap items-center gap-0.5">
              {links.map((link) => {
                const label = platformLabel(link.platform);
                return (
                  <li key={link.platform}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer me"
                      title={label}
                      aria-label={label}
                      className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <SocialPlatformIcon platform={link.platform} size={16} />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </header>

      <LibraryTab userId={user.id} isOwner={false} layout="grid" />
    </Page>
  );
}
