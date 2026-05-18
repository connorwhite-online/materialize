import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { CreateOrganization } from "@clerk/nextjs";

// Standalone "create your first organization" page. Lives at /o/new
// because that's the natural URL when someone wants to spin up a new
// team but isn't yet a member of any. The org switcher in the nav
// only renders once you HAVE an org (otherwise it falls back to a
// stylistically off "Personal account" pill that doesn't match the
// rest of the chrome), so this page is the canonical entry point.
//
// We don't hand-build the form — Clerk's <CreateOrganization /> ships
// the input, slug autogen, image upload, and validation. We just gate
// it behind auth and route the user to their new org's profile on
// success via afterCreateOrganizationUrl.

export default async function NewOrganizationPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/o/new");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Create an organization</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Organizations let hardware teams share files, projects, and
          collections privately across members.
        </p>
      </div>
      <CreateOrganization
        routing="hash"
        afterCreateOrganizationUrl={(org) => `/${org.slug}`}
      />
    </div>
  );
}
