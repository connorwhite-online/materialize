import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { NotificationsTab } from "@/components/profile/notifications-tab";

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
