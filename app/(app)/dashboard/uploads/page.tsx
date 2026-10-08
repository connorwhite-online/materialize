import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";

export const metadata = { title: "Uploads" };

export default async function UploadsRedirect() {
  const user = await currentUser();
  if (!user) redirect("/");
  if (!user.username) redirect("/onboarding");
  redirect("/dashboard/library");
}
