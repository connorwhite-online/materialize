import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { EarningsTab } from "@/components/profile/earnings-tab";

export default async function EarningsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");
  const user = await currentUser();
  if (!user?.username) redirect("/onboarding");

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Earnings</h1>
      <EarningsTab userId={userId} />
    </div>
  );
}
