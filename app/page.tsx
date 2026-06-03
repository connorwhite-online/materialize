import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AnonHome } from "@/components/home/anon-home";

export default async function HomePage() {
  // Authed home = the user's own profile. Materialize is mostly a
  // personal-files tool, and the profile/dashboard is what they
  // come here to see. Anon visitors keep getting the marketing hero
  // below. A user without a username is mid-onboarding — punt them
  // there so we don't render a logged-in shell over an incomplete
  // account.
  const { userId } = await auth();
  if (userId) {
    const user = await currentUser();
    if (user?.username) {
      redirect(`/${user.username}`);
    }
    redirect("/onboarding");
  }

  // Anon home is a scroll-driven cinematic: a single persistent 3D
  // scene pinned behind five snapped sections. AnonHome is a client
  // component but still server-rendered (only its <Canvas> is
  // ssr:false), so the headings + section copy + footer links ship as
  // real, crawlable HTML.
  return <AnonHome />;
}
