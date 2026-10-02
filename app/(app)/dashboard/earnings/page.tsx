import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { EarningsTab } from "@/components/profile/earnings-tab";
import { Page, PageHeader } from "@/components/ui/page";
import { Download } from "@/components/icons/download";

export default async function EarningsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");
  const user = await currentUser();
  if (!user?.username) redirect("/onboarding");

  return (
    <Page>
      <PageHeader
        icon={<Download />}
        title="Earnings"
        description="Sales of your files, and the downloads and prints they drove."
      />
      <EarningsTab userId={userId} />
    </Page>
  );
}
