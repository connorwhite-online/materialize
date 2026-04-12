import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";

export default async function DashboardRedirect() {
  const user = await currentUser();
  if (!user) redirect("/");
  if (!user.username) redirect("/onboarding");
  redirect(`/u/${user.username}`);
}
