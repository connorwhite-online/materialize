import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { NotificationsTab } from "@/components/profile/notifications-tab";

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
 */
export default async function NotificationsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");
  const user = await currentUser();
  if (!user?.username) redirect("/onboarding");

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Notifications</h1>
      <NotificationsTab userId={userId} />
    </div>
  );
}
