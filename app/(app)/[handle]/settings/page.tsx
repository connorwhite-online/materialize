import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { OrganizationProfile } from "@clerk/nextjs";
import { resolveHandle } from "@/lib/handles/resolve";
import { isOrgMember } from "@/lib/authorization";

// Settings sub-route under the unified `/[handle]` namespace. User
// account settings live on the own-profile page (`/${username}` and
// `?tab=general`); this route 404s for other people's handles and
// redirects the owner there. For orgs it hosts Clerk's
// <OrganizationProfile />.

export default async function HandleSettingsPage(props: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await props.params;
  const { userId } = await auth();
  if (!userId) redirect(`/sign-in?redirect_url=/${handle}/settings`);

  const resolution = await resolveHandle(handle);
  // User-handle settings don't live here — bounce to the global
  // dashboard settings if the viewer is the owner, otherwise 404.
  if (!resolution) notFound();
  if (resolution.kind === "user") {
    if (resolution.userId === userId) redirect(`/${handle}?tab=general`);
    notFound();
  }

  const membership = await isOrgMember(userId, resolution.orgId);
  if (!membership.member || membership.role !== "admin") {
    redirect(`/${handle}`);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <OrganizationProfile routing="hash" />
    </div>
  );
}
