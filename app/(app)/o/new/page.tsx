import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { UsersIcon } from "lucide-react";
import { CreateFormHeader } from "@/components/create-form-header";
import { OrganizationCreateForm } from "@/components/orgs/organization-create-form";

// Standalone "create your first organization" page. Lives at /o/new
// because that's the natural URL when someone wants to spin up a new
// team but isn't yet a member of any. The org switcher in the nav
// only renders once you HAVE an org (otherwise it falls back to a
// stylistically off "Personal account" pill that doesn't match the
// rest of the chrome), so this page is the canonical entry point.
//
// Same shape as /projects/new and /collections/new. The form is ours;
// Clerk still creates the org (see OrganizationCreateForm).

export const metadata: Metadata = { title: "New organization" };

export default async function NewOrganizationPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/o/new");

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <CreateFormHeader
        icon={<UsersIcon className="size-7" />}
        title="New organization"
        description="Organizations let hardware teams share files, projects, and collections privately across members."
      />
      <OrganizationCreateForm />
    </div>
  );
}
