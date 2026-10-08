import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";

export const metadata = { title: "Library" };

export default async function LibraryRedirect() {
  const user = await currentUser();
  if (!user) redirect("/");
  if (!user.username) redirect("/onboarding");
  redirect("/");
}
