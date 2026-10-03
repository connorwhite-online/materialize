import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NotificationsTab } from "@/components/profile/notifications-tab";
import { Page, PageHeader } from "@/components/ui/page";
import { NotificationSettingsGear } from "@/components/notifications/notification-settings-gear";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false, follow: false },
};

/**
 * The inbox as a real page. Desktop reaches the same stream through the
 * bell popover in the top bar; the mobile nav has no room for a popover,
 * so Notifications is a first-class destination in its menu and lands
 * here. Moved from /dashboard/comments (which now redirects) so the URL
 * matches the nav label.
 *
 * Email prefs live behind the chunky gear opposite the headline — not
 * under the profile Settings tab — so they're one tap from the inbox.
 */
export default async function NotificationsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");
  const user = await currentUser();
  if (!user?.username) redirect("/onboarding");

  const [prefs] = await db
    .select({
      emailNotificationsEnabled: users.emailNotificationsEnabled,
      emailNotificationPrefs: users.emailNotificationPrefs,
    })
    .from(users)
    .where(eq(users.id, userId));

  return (
    <Page width="narrow">
      <PageHeader
        title="Notifications"
        description="Sales, comments and order updates."
        actions={
          <NotificationSettingsGear
            initialEnabled={prefs?.emailNotificationsEnabled ?? true}
            initialPrefs={prefs?.emailNotificationPrefs ?? null}
          />
        }
      />
      <NotificationsTab userId={userId} />
    </Page>
  );
}
