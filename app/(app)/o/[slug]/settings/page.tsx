import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { OrganizationProfile } from "@clerk/nextjs";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isOrgMember } from "@/lib/authorization";

// Org settings — invitations, member roles, profile. We don't
// hand-build any of this UI; Clerk's <OrganizationProfile /> ships
// the lot. We just wall it off behind admin-only access and route
// it under our own URL scheme so the org slug stays in the address
// bar.

export default async function OrgSettingsPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const { userId } = await auth();
  if (!userId) redirect(`/sign-in?redirect_url=/o/${slug}/settings`);

  const [org] = await db
    .select({ id: organizations.id, slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.slug, slug));
  if (!org) notFound();

  const membership = await isOrgMember(userId, org.id);
  if (!membership.member || membership.role !== "admin") {
    redirect(`/o/${org.slug}`);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <OrganizationProfile routing="hash" />
    </div>
  );
}
