import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";

// Dashboard's "comments inbox" view lives on the profile page as a
// `?tab=comments` panel — same convention as orders / earnings — so
// the dashboard route just redirects there.
export default async function CommentsRedirect() {
  const user = await currentUser();
  if (!user) redirect("/");
  if (!user.username) redirect("/onboarding");
  redirect(`/${user.username}?tab=comments`);
}
